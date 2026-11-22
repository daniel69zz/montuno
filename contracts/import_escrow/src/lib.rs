//! Contrato escrow para pedidos de importación bajo pedido.
//!
//! Un único contrato guarda un registro por `order_id` (BytesN<32>). El comprador
//! financia el 100% en una sola operación atómica (`create_and_fund`), autorizando
//! criptográficamente todos los términos económicos. Dos modalidades:
//!
//! - `FullEscrow`: nada se libera hasta confirmación del comprador o resolución del árbitro.
//! - `PartialAdvance`: la importadora puede reclamar UNA vez un anticipo fijado y aceptado
//!   por el comprador, antes de comprar. El anticipo pagado NO es recuperable on-chain.
//!
//! Invariante central (siempre verificada antes de persistir):
//! `amount_total == seller_released + buyer_refunded + remaining_escrow`.
//!
//! No existe función administrativa para mover fondos ajenos, ni upgrade del WASM,
//! ni forma de cambiar token, participantes o anticipo de una orden existente.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN, Env,
};

/// 10_000 puntos básicos = 100%.
pub const BPS_DENOMINATOR: i128 = 10_000;

// TTL en ledgers (~5 s por ledger).
const DAY_IN_LEDGERS: u32 = 17_280;
const ORDER_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const ORDER_TTL_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;
const INSTANCE_TTL_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const INSTANCE_TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    OrderExists = 1,
    OrderNotFound = 2,
    TokenNotAllowed = 3,
    ArbiterNotAllowed = 4,
    InvalidAmount = 5,
    InvalidAdvance = 6,
    ModeMismatch = 7,
    FundingDeadlinePassed = 8,
    InvalidDeadline = 9,
    InvalidParticipants = 10,
    InvalidState = 11,
    AdvanceNotAllowed = 12,
    AdvanceAlreadyClaimed = 13,
    NotParticipant = 14,
    InvalidResolution = 15,
    DisputeActive = 16,
    TransferMismatch = 17,
    Overflow = 18,
    InvalidConfig = 19,
    InvariantViolated = 20,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Mode {
    FullEscrow = 0,
    PartialAdvance = 1,
}

/// Estados verificables del contrato. No existe estado "creado sin fondos":
/// la creación y el financiamiento son atómicos.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Status {
    Funded = 0,
    AdvancePaid = 1,
    Disputed = 2,
    Settled = 3,
    Cancelled = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    /// Único token aceptado (SAC o token compatible). Inmutable tras el despliegue.
    pub token: Address,
    /// Árbitro asignado a las órdenes NUEVAS. Cambiarlo no afecta órdenes existentes.
    pub arbiter: Address,
    /// Tope global de anticipo en bps (defensa en profundidad; el tope por importadora es off-chain).
    pub max_advance_bps: u32,
}

/// Términos que el comprador autoriza en `create_and_fund`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrderTerms {
    pub importer: Address,
    pub arbiter: Address,
    pub token: Address,
    pub amount_total: i128,
    pub advance_amount: i128,
    pub mode: Mode,
    pub terms_hash: BytesN<32>,
    pub funding_deadline: u64,
    pub fulfillment_deadline: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub order_id: BytesN<32>,
    pub buyer: Address,
    pub importer: Address,
    pub arbiter: Address,
    pub asset: Address,
    pub amount_total: i128,
    pub advance_amount: i128,
    pub advance_released: i128,
    pub seller_released: i128,
    pub buyer_refunded: i128,
    pub remaining_escrow: i128,
    pub terms_hash: BytesN<32>,
    pub mode: Mode,
    pub funding_deadline: u64,
    pub fulfillment_deadline: u64,
    pub status: Status,
    pub funded_at: u64,
    pub dispute_opened_by: Option<Address>,
    pub dispute_reason_hash: Option<BytesN<32>>,
    pub resolution_hash: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Config,
    Order(BytesN<32>),
}

// ----------------------------------------------------------------------------
// Eventos (topic principal = nombre del struct en snake_case)
// ----------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowCreated {
    #[topic]
    pub order_id: BytesN<32>,
    pub buyer: Address,
    pub importer: Address,
    pub arbiter: Address,
    pub mode: Mode,
    pub amount_total: i128,
    pub advance_amount: i128,
    pub terms_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Funded {
    #[topic]
    pub order_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdvanceReleased {
    #[topic]
    pub order_id: BytesN<32>,
    pub amount: i128,
    pub remaining_escrow: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeliveryConfirmed {
    #[topic]
    pub order_id: BytesN<32>,
    pub released_to_importer: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeOpened {
    #[topic]
    pub order_id: BytesN<32>,
    pub opened_by: Address,
    pub reason_hash: BytesN<32>,
    pub remaining_escrow: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeResolved {
    #[topic]
    pub order_id: BytesN<32>,
    pub refund_to_buyer: i128,
    pub release_to_importer: i128,
    pub resolution_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refunded {
    #[topic]
    pub order_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Cancelled {
    #[topic]
    pub order_id: BytesN<32>,
    pub refunded_to_buyer: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArbiterChanged {
    pub previous: Address,
    pub new_arbiter: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub previous: Address,
    pub new_admin: Address,
}

#[contract]
pub struct ImportEscrowContract;

#[contractimpl]
impl ImportEscrowContract {
    /// Configuración única en el despliegue. No existe re-inicialización.
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        arbiter: Address,
        max_advance_bps: u32,
    ) -> Result<(), Error> {
        if max_advance_bps == 0 || (max_advance_bps as i128) >= BPS_DENOMINATOR {
            return Err(Error::InvalidConfig);
        }
        if admin == arbiter {
            return Err(Error::InvalidConfig);
        }
        let cfg = Config {
            admin,
            token,
            arbiter,
            max_advance_bps,
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        bump_instance(&env);
        Ok(())
    }

    /// El comprador autoriza términos + transferencia del 100% en una operación atómica.
    pub fn create_and_fund(
        env: Env,
        order_id: BytesN<32>,
        buyer: Address,
        terms: OrderTerms,
    ) -> Result<Order, Error> {
        // La autorización cubre los argumentos exactos (order_id, buyer, terms)
        // y la sub-invocación token.transfer.
        buyer.require_auth();
        let cfg = read_config(&env);
        let key = DataKey::Order(order_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::OrderExists);
        }
        if terms.token != cfg.token {
            return Err(Error::TokenNotAllowed);
        }
        if terms.arbiter != cfg.arbiter {
            return Err(Error::ArbiterNotAllowed);
        }
        if buyer == terms.importer || buyer == terms.arbiter || terms.importer == terms.arbiter {
            return Err(Error::InvalidParticipants);
        }
        let contract_addr = env.current_contract_address();
        if buyer == contract_addr || terms.importer == contract_addr {
            return Err(Error::InvalidParticipants);
        }
        if terms.amount_total <= 0 {
            return Err(Error::InvalidAmount);
        }
        match terms.mode {
            Mode::FullEscrow => {
                if terms.advance_amount != 0 {
                    return Err(Error::ModeMismatch);
                }
            }
            Mode::PartialAdvance => {
                if terms.advance_amount <= 0 || terms.advance_amount >= terms.amount_total {
                    return Err(Error::InvalidAdvance);
                }
                let lhs = terms
                    .advance_amount
                    .checked_mul(BPS_DENOMINATOR)
                    .ok_or(Error::Overflow)?;
                let rhs = terms
                    .amount_total
                    .checked_mul(cfg.max_advance_bps as i128)
                    .ok_or(Error::Overflow)?;
                if lhs > rhs {
                    return Err(Error::InvalidAdvance);
                }
            }
        }
        let now = env.ledger().timestamp();
        if now > terms.funding_deadline {
            return Err(Error::FundingDeadlinePassed);
        }
        if terms.fulfillment_deadline <= now || terms.fulfillment_deadline < terms.funding_deadline
        {
            return Err(Error::InvalidDeadline);
        }

        let order = Order {
            order_id: order_id.clone(),
            buyer: buyer.clone(),
            importer: terms.importer.clone(),
            arbiter: terms.arbiter.clone(),
            asset: terms.token.clone(),
            amount_total: terms.amount_total,
            advance_amount: terms.advance_amount,
            advance_released: 0,
            seller_released: 0,
            buyer_refunded: 0,
            remaining_escrow: terms.amount_total,
            terms_hash: terms.terms_hash.clone(),
            mode: terms.mode,
            funding_deadline: terms.funding_deadline,
            fulfillment_deadline: terms.fulfillment_deadline,
            status: Status::Funded,
            funded_at: now,
            dispute_opened_by: None,
            dispute_reason_hash: None,
            resolution_hash: None,
        };
        check_invariant(&order)?;

        // Transferencia con verificación de delta real del saldo del contrato
        // (protege ante tokens con comisión de transferencia).
        let tk = token::Client::new(&env, &cfg.token);
        let before = tk.balance(&contract_addr);
        tk.transfer(&buyer, &contract_addr, &terms.amount_total);
        let after = tk.balance(&contract_addr);
        if after.checked_sub(before) != Some(terms.amount_total) {
            return Err(Error::TransferMismatch);
        }

        save_order(&env, &order);
        bump_instance(&env);

        EscrowCreated {
            order_id: order_id.clone(),
            buyer,
            importer: order.importer.clone(),
            arbiter: order.arbiter.clone(),
            mode: order.mode,
            amount_total: order.amount_total,
            advance_amount: order.advance_amount,
            terms_hash: order.terms_hash.clone(),
        }
        .publish(&env);
        Funded {
            order_id,
            amount: order.amount_total,
        }
        .publish(&env);
        Ok(order)
    }

    /// Solo importadora, solo PARTIAL_ADVANCE, solo una vez, sin disputa.
    /// No exige comprobante de compra: el anticipo existe para financiar la compra.
    pub fn claim_advance(env: Env, order_id: BytesN<32>) -> Result<Order, Error> {
        let mut order = load_order(&env, &order_id)?;
        order.importer.require_auth();
        if order.mode != Mode::PartialAdvance {
            return Err(Error::AdvanceNotAllowed);
        }
        match order.status {
            Status::Funded => {}
            Status::AdvancePaid => return Err(Error::AdvanceAlreadyClaimed),
            Status::Disputed => return Err(Error::DisputeActive),
            _ => return Err(Error::InvalidState),
        }
        if order.advance_released != 0 {
            return Err(Error::AdvanceAlreadyClaimed);
        }
        let amount = order.advance_amount;
        order.advance_released = amount;
        order.seller_released = order
            .seller_released
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        order.remaining_escrow = order
            .remaining_escrow
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;
        order.status = Status::AdvancePaid;
        check_invariant(&order)?;
        save_order(&env, &order);

        token::Client::new(&env, &order.asset).transfer(
            &env.current_contract_address(),
            &order.importer,
            &amount,
        );
        AdvanceReleased {
            order_id,
            amount,
            remaining_escrow: order.remaining_escrow,
        }
        .publish(&env);
        Ok(order)
    }

    /// El comprador confirma la entrega; se libera ÚNICAMENTE el saldo retenido.
    pub fn confirm_delivery_and_release(env: Env, order_id: BytesN<32>) -> Result<Order, Error> {
        let mut order = load_order(&env, &order_id)?;
        order.buyer.require_auth();
        match order.status {
            Status::Funded | Status::AdvancePaid => {}
            Status::Disputed => return Err(Error::DisputeActive),
            _ => return Err(Error::InvalidState),
        }
        let amount = order.remaining_escrow;
        order.seller_released = order
            .seller_released
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        order.remaining_escrow = 0;
        order.status = Status::Settled;
        check_invariant(&order)?;
        save_order(&env, &order);

        if amount > 0 {
            token::Client::new(&env, &order.asset).transfer(
                &env.current_contract_address(),
                &order.importer,
                &amount,
            );
        }
        DeliveryConfirmed {
            order_id,
            released_to_importer: amount,
        }
        .publish(&env);
        Ok(order)
    }

    /// Comprador o importadora; congela toda liberación mientras dure.
    pub fn open_dispute(
        env: Env,
        order_id: BytesN<32>,
        caller: Address,
        reason_hash: BytesN<32>,
    ) -> Result<Order, Error> {
        let mut order = load_order(&env, &order_id)?;
        if caller != order.buyer && caller != order.importer {
            return Err(Error::NotParticipant);
        }
        caller.require_auth();
        match order.status {
            Status::Funded | Status::AdvancePaid => {}
            Status::Disputed => return Err(Error::DisputeActive),
            _ => return Err(Error::InvalidState),
        }
        order.status = Status::Disputed;
        order.dispute_opened_by = Some(caller.clone());
        order.dispute_reason_hash = Some(reason_hash.clone());
        check_invariant(&order)?;
        save_order(&env, &order);
        DisputeOpened {
            order_id,
            opened_by: caller,
            reason_hash,
            remaining_escrow: order.remaining_escrow,
        }
        .publish(&env);
        Ok(order)
    }

    /// Solo el árbitro de ESTA orden. Reparte exactamente el saldo retenido;
    /// jamás puede tocar el anticipo ya transferido.
    pub fn resolve_dispute(
        env: Env,
        order_id: BytesN<32>,
        refund_to_buyer: i128,
        release_to_importer: i128,
        resolution_hash: BytesN<32>,
    ) -> Result<Order, Error> {
        let mut order = load_order(&env, &order_id)?;
        order.arbiter.require_auth();
        if order.status != Status::Disputed {
            return Err(Error::InvalidState);
        }
        if refund_to_buyer < 0 || release_to_importer < 0 {
            return Err(Error::InvalidResolution);
        }
        let sum = refund_to_buyer
            .checked_add(release_to_importer)
            .ok_or(Error::Overflow)?;
        if sum != order.remaining_escrow {
            return Err(Error::InvalidResolution);
        }
        order.buyer_refunded = order
            .buyer_refunded
            .checked_add(refund_to_buyer)
            .ok_or(Error::Overflow)?;
        order.seller_released = order
            .seller_released
            .checked_add(release_to_importer)
            .ok_or(Error::Overflow)?;
        order.remaining_escrow = 0;
        order.status = Status::Settled;
        order.resolution_hash = Some(resolution_hash.clone());
        check_invariant(&order)?;
        save_order(&env, &order);

        let tk = token::Client::new(&env, &order.asset);
        let this = env.current_contract_address();
        if refund_to_buyer > 0 {
            tk.transfer(&this, &order.buyer, &refund_to_buyer);
        }
        if release_to_importer > 0 {
            tk.transfer(&this, &order.importer, &release_to_importer);
        }
        DisputeResolved {
            order_id: order_id.clone(),
            refund_to_buyer,
            release_to_importer,
            resolution_hash,
        }
        .publish(&env);
        if refund_to_buyer > 0 {
            Refunded {
                order_id,
                amount: refund_to_buyer,
            }
            .publish(&env);
        }
        Ok(order)
    }

    /// Cancelación consensuada: requiere firma de comprador E importadora, sin disputa.
    /// Devuelve al comprador solo el saldo retenido (el anticipo pagado no vuelve).
    pub fn cancel_by_agreement(env: Env, order_id: BytesN<32>) -> Result<Order, Error> {
        let mut order = load_order(&env, &order_id)?;
        order.buyer.require_auth();
        order.importer.require_auth();
        match order.status {
            Status::Funded | Status::AdvancePaid => {}
            Status::Disputed => return Err(Error::DisputeActive),
            _ => return Err(Error::InvalidState),
        }
        let amount = order.remaining_escrow;
        order.buyer_refunded = order
            .buyer_refunded
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        order.remaining_escrow = 0;
        order.status = Status::Cancelled;
        check_invariant(&order)?;
        save_order(&env, &order);

        if amount > 0 {
            token::Client::new(&env, &order.asset).transfer(
                &env.current_contract_address(),
                &order.buyer,
                &amount,
            );
            Refunded {
                order_id: order_id.clone(),
                amount,
            }
            .publish(&env);
        }
        Cancelled {
            order_id,
            refunded_to_buyer: amount,
        }
        .publish(&env);
        Ok(order)
    }

    pub fn get_order(env: Env, order_id: BytesN<32>) -> Result<Order, Error> {
        let key = DataKey::Order(order_id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::OrderNotFound)
    }

    pub fn has_order(env: Env, order_id: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Order(order_id))
    }

    pub fn get_config(env: Env) -> Config {
        read_config(&env)
    }

    /// Renovación de TTL sin permisos (quien la invoca paga la fee). No cambia estado.
    pub fn extend_ttl(env: Env, order_id: BytesN<32>) -> Result<(), Error> {
        let key = DataKey::Order(order_id);
        if !env.storage().persistent().has(&key) {
            return Err(Error::OrderNotFound);
        }
        bump_order(&env, &key);
        bump_instance(&env);
        Ok(())
    }

    /// Cambia el árbitro para órdenes NUEVAS. Las órdenes existentes conservan el suyo.
    pub fn set_arbiter(env: Env, new_arbiter: Address) -> Result<(), Error> {
        let mut cfg = read_config(&env);
        cfg.admin.require_auth();
        if new_arbiter == cfg.admin {
            return Err(Error::InvalidConfig);
        }
        let previous = cfg.arbiter.clone();
        cfg.arbiter = new_arbiter.clone();
        env.storage().instance().set(&DataKey::Config, &cfg);
        bump_instance(&env);
        ArbiterChanged {
            previous,
            new_arbiter,
        }
        .publish(&env);
        Ok(())
    }

    /// Rotación de admin: requiere firma del admin actual y del nuevo.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let mut cfg = read_config(&env);
        cfg.admin.require_auth();
        new_admin.require_auth();
        if new_admin == cfg.arbiter {
            return Err(Error::InvalidConfig);
        }
        let previous = cfg.admin.clone();
        cfg.admin = new_admin.clone();
        env.storage().instance().set(&DataKey::Config, &cfg);
        bump_instance(&env);
        AdminChanged {
            previous,
            new_admin,
        }
        .publish(&env);
        Ok(())
    }
}

fn read_config(env: &Env) -> Config {
    // El constructor garantiza que existe.
    env.storage().instance().get(&DataKey::Config).unwrap()
}

fn load_order(env: &Env, order_id: &BytesN<32>) -> Result<Order, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Order(order_id.clone()))
        .ok_or(Error::OrderNotFound)
}

fn save_order(env: &Env, order: &Order) {
    let key = DataKey::Order(order.order_id.clone());
    env.storage().persistent().set(&key, order);
    bump_order(env, &key);
}

fn bump_order(env: &Env, key: &DataKey) {
    let max = env.storage().max_ttl();
    let extend_to = if ORDER_TTL_EXTEND_TO > max {
        max
    } else {
        ORDER_TTL_EXTEND_TO
    };
    let threshold = if ORDER_TTL_THRESHOLD > extend_to {
        extend_to
    } else {
        ORDER_TTL_THRESHOLD
    };
    env.storage()
        .persistent()
        .extend_ttl(key, threshold, extend_to);
}

fn bump_instance(env: &Env) {
    let max = env.storage().max_ttl();
    let extend_to = if INSTANCE_TTL_EXTEND_TO > max {
        max
    } else {
        INSTANCE_TTL_EXTEND_TO
    };
    let threshold = if INSTANCE_TTL_THRESHOLD > extend_to {
        extend_to
    } else {
        INSTANCE_TTL_THRESHOLD
    };
    env.storage().instance().extend_ttl(threshold, extend_to);
}

fn check_invariant(o: &Order) -> Result<(), Error> {
    if o.seller_released < 0
        || o.buyer_refunded < 0
        || o.remaining_escrow < 0
        || o.advance_released < 0
        || o.advance_released > o.advance_amount
        || o.advance_amount >= o.amount_total && o.mode == Mode::PartialAdvance
    {
        return Err(Error::InvariantViolated);
    }
    let sum = o
        .seller_released
        .checked_add(o.buyer_refunded)
        .and_then(|s| s.checked_add(o.remaining_escrow))
        .ok_or(Error::Overflow)?;
    if sum != o.amount_total {
        return Err(Error::InvariantViolated);
    }
    Ok(())
}
