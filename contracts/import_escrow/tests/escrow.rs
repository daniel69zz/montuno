//! Batería de pruebas del contrato escrow (ver guía §6).
use import_escrow::{
    AdvanceReleased, Cancelled, DeliveryConfirmed, DisputeOpened, DisputeResolved, Error,
    EscrowCreated, Funded, ImportEscrowContract, ImportEscrowContractClient, Mode, OrderTerms,
    Refunded, Status,
};
use soroban_sdk::{
    testutils::{
        storage::Persistent as _, Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Event, IntoVal,
};

// 7 decimales: 1 unidad = 10_000_000 atómicas.
const UNIT: i128 = 10_000_000;
const TOTAL: i128 = 1_200 * UNIT;
const ADVANCE: i128 = 900 * UNIT;
const NOW: u64 = 1_800_000_000;
const MAX_ADVANCE_BPS: u32 = 9_000;

struct T {
    env: Env,
    escrow: Address,
    token: Address,
    admin: Address,
    arbiter: Address,
    buyer: Address,
    importer: Address,
}

impl T {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| {
            l.timestamp = NOW;
            l.sequence_number = 1_000;
        });
        let admin = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let buyer = Address::generate(&env);
        let importer = Address::generate(&env);
        let issuer = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(issuer).address();
        let escrow = env.register(
            ImportEscrowContract,
            (
                admin.clone(),
                token.clone(),
                arbiter.clone(),
                MAX_ADVANCE_BPS,
            ),
        );
        StellarAssetClient::new(&env, &token).mint(&buyer, &(10_000 * UNIT));
        T {
            env,
            escrow,
            token,
            admin,
            arbiter,
            buyer,
            importer,
        }
    }
    fn c(&self) -> ImportEscrowContractClient<'_> {
        ImportEscrowContractClient::new(&self.env, &self.escrow)
    }
    fn tk(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.token)
    }
    fn bal(&self, a: &Address) -> i128 {
        self.tk().balance(a)
    }
    fn id(&self, n: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[n; 32])
    }
    fn h(&self, n: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[n.wrapping_add(100); 32])
    }
    fn terms(&self, mode: Mode, total: i128, advance: i128) -> OrderTerms {
        OrderTerms {
            importer: self.importer.clone(),
            arbiter: self.arbiter.clone(),
            token: self.token.clone(),
            amount_total: total,
            advance_amount: advance,
            mode,
            terms_hash: self.h(1),
            funding_deadline: NOW + 3_600,
            fulfillment_deadline: NOW + 30 * 86_400,
        }
    }
    fn full(&self, n: u8) -> BytesN<32> {
        let id = self.id(n);
        self.c()
            .create_and_fund(&id, &self.buyer, &self.terms(Mode::FullEscrow, TOTAL, 0));
        id
    }
    fn partial(&self, n: u8) -> BytesN<32> {
        let id = self.id(n);
        self.c().create_and_fund(
            &id,
            &self.buyer,
            &self.terms(Mode::PartialAdvance, TOTAL, ADVANCE),
        );
        id
    }
    fn assert_invariant(&self, id: &BytesN<32>) {
        let o = self.c().get_order(id);
        assert_eq!(
            o.amount_total,
            o.seller_released + o.buyer_refunded + o.remaining_escrow
        );
        assert!(o.remaining_escrow >= 0 && o.seller_released >= 0 && o.buyer_refunded >= 0);
    }
    fn has_event<E: Event>(&self, e: E) -> bool {
        let want = e.to_xdr(&self.env, &self.escrow);
        self.env
            .events()
            .all()
            .filter_by_contract(&self.escrow)
            .events()
            .contains(&want)
    }
}

fn contract_err<T: core::fmt::Debug, C: core::fmt::Debug>(
    r: Result<Result<T, C>, Result<Error, soroban_sdk::InvokeError>>,
) -> Error {
    match r {
        Err(Ok(e)) => e,
        other => panic!("se esperaba error de contrato, obtuve {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Flujos felices
// ---------------------------------------------------------------------------

#[test]
fn full_fund_confirm_releases_100_percent() {
    let t = T::new();
    let b0 = t.bal(&t.buyer);
    let id = t.full(1);
    assert!(t.has_event(Funded {
        order_id: id.clone(),
        amount: TOTAL
    }));
    assert_eq!(t.bal(&t.escrow), TOTAL);
    assert_eq!(t.bal(&t.buyer), b0 - TOTAL);
    let o = t.c().get_order(&id);
    assert_eq!(o.status, Status::Funded);
    assert_eq!(o.remaining_escrow, TOTAL);
    // auth exacta del comprador sobre los argumentos
    t.c().confirm_delivery_and_release(&id);
    let auths = t.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, t.buyer);
    assert!(t.has_event(DeliveryConfirmed {
        order_id: id.clone(),
        released_to_importer: TOTAL
    }));
    let o = t.c().get_order(&id);
    assert_eq!(o.status, Status::Settled);
    assert_eq!(o.remaining_escrow, 0);
    assert_eq!(o.seller_released, TOTAL);
    assert_eq!(t.bal(&t.importer), TOTAL);
    assert_eq!(t.bal(&t.escrow), 0);
    t.assert_invariant(&id);
}

#[test]
fn create_and_fund_requires_buyer_auth_over_exact_args() {
    let t = T::new();
    let id = t.id(1);
    let terms = t.terms(Mode::FullEscrow, TOTAL, 0);
    t.c().create_and_fund(&id, &t.buyer, &terms);
    let auths = t.env.auths();
    assert_eq!(auths.len(), 1);
    let (addr, inv) = &auths[0];
    assert_eq!(addr, &t.buyer);
    match &inv.function {
        soroban_sdk::testutils::AuthorizedFunction::Contract((c, f, args)) => {
            assert_eq!(c, &t.escrow);
            assert_eq!(f, &soroban_sdk::Symbol::new(&t.env, "create_and_fund"));
            let expected: soroban_sdk::Vec<soroban_sdk::Val> =
                (id.clone(), t.buyer.clone(), terms.clone()).into_val(&t.env);
            assert_eq!(args, &expected);
        }
        _ => panic!("función inesperada"),
    }
    // La transferencia del token es una sub-invocación de la misma autorización.
    assert_eq!(inv.sub_invocations.len(), 1);
    assert!(t.has_event(EscrowCreated {
        order_id: id.clone(),
        buyer: t.buyer.clone(),
        importer: t.importer.clone(),
        arbiter: t.arbiter.clone(),
        mode: Mode::FullEscrow,
        amount_total: TOTAL,
        advance_amount: 0,
        terms_hash: t.h(1),
    }));
}

#[test]
fn partial_fund_advance_once_then_confirm_releases_rest() {
    let t = T::new();
    let id = t.partial(1);
    t.c().claim_advance(&id);
    assert_eq!(t.env.auths()[0].0, t.importer);
    assert!(t.has_event(AdvanceReleased {
        order_id: id.clone(),
        amount: ADVANCE,
        remaining_escrow: TOTAL - ADVANCE
    }));
    assert_eq!(t.bal(&t.importer), ADVANCE);
    assert_eq!(t.bal(&t.escrow), TOTAL - ADVANCE);
    let o = t.c().get_order(&id);
    assert_eq!(o.status, Status::AdvancePaid);
    assert_eq!(o.advance_released, ADVANCE);
    assert_eq!(o.remaining_escrow, 300 * UNIT);
    t.assert_invariant(&id);

    assert_eq!(
        contract_err(t.c().try_claim_advance(&id)),
        Error::AdvanceAlreadyClaimed
    );
    t.c().confirm_delivery_and_release(&id);
    assert_eq!(t.bal(&t.importer), TOTAL);
    assert_eq!(t.bal(&t.escrow), 0);
    let o = t.c().get_order(&id);
    assert_eq!(o.status, Status::Settled);
    assert_eq!(o.remaining_escrow, 0);
    // replay: ni anticipo ni liberación de nuevo
    assert_eq!(
        contract_err(t.c().try_claim_advance(&id)),
        Error::InvalidState
    );
    assert_eq!(
        contract_err(t.c().try_confirm_delivery_and_release(&id)),
        Error::InvalidState
    );
    t.assert_invariant(&id);
}

#[test]
fn partial_confirm_without_claiming_advance_releases_full_amount() {
    let t = T::new();
    let id = t.partial(1);
    t.c().confirm_delivery_and_release(&id);
    assert_eq!(t.bal(&t.importer), TOTAL);
    let o = t.c().get_order(&id);
    assert_eq!(o.advance_released, 0);
    assert_eq!(o.seller_released, TOTAL);
}

// ---------------------------------------------------------------------------
// Validaciones de creación
// ---------------------------------------------------------------------------

#[test]
fn unfunded_order_does_not_exist() {
    let t = T::new();
    let id = t.id(9);
    assert!(!t.c().has_order(&id));
    assert_eq!(contract_err(t.c().try_get_order(&id)), Error::OrderNotFound);
    assert_eq!(
        contract_err(t.c().try_claim_advance(&id)),
        Error::OrderNotFound
    );
    assert_eq!(
        contract_err(t.c().try_confirm_delivery_and_release(&id)),
        Error::OrderNotFound
    );
    assert_eq!(
        contract_err(t.c().try_open_dispute(&id, &t.buyer, &t.h(2))),
        Error::OrderNotFound
    );
    assert_eq!(
        contract_err(t.c().try_resolve_dispute(&id, &0, &0, &t.h(3))),
        Error::OrderNotFound
    );
    assert_eq!(
        contract_err(t.c().try_cancel_by_agreement(&id)),
        Error::OrderNotFound
    );
    assert_eq!(
        contract_err(t.c().try_extend_ttl(&id)),
        Error::OrderNotFound
    );
}

#[test]
fn expired_quote_cannot_be_funded() {
    let t = T::new();
    let mut terms = t.terms(Mode::FullEscrow, TOTAL, 0);
    terms.funding_deadline = NOW - 1;
    assert_eq!(
        contract_err(t.c().try_create_and_fund(&t.id(1), &t.buyer, &terms)),
        Error::FundingDeadlinePassed
    );
    // también si el ledger avanza más allá del plazo
    let terms = t.terms(Mode::FullEscrow, TOTAL, 0);
    t.env.ledger().with_mut(|l| l.timestamp = NOW + 3_601);
    assert_eq!(
        contract_err(t.c().try_create_and_fund(&t.id(2), &t.buyer, &terms)),
        Error::FundingDeadlinePassed
    );
}

#[test]
fn invalid_fulfillment_deadline_rejected() {
    let t = T::new();
    let mut terms = t.terms(Mode::FullEscrow, TOTAL, 0);
    terms.fulfillment_deadline = terms.funding_deadline - 1;
    assert_eq!(
        contract_err(t.c().try_create_and_fund(&t.id(1), &t.buyer, &terms)),
        Error::InvalidDeadline
    );
}

#[test]
fn duplicate_order_id_rejected_and_funds_not_taken_twice() {
    let t = T::new();
    let id = t.full(1);
    let b = t.bal(&t.buyer);
    assert_eq!(
        contract_err(t.c().try_create_and_fund(
            &id,
            &t.buyer,
            &t.terms(Mode::FullEscrow, TOTAL, 0)
        )),
        Error::OrderExists
    );
    assert_eq!(t.bal(&t.buyer), b);
    assert_eq!(t.bal(&t.escrow), TOTAL);
}

#[test]
fn wrong_token_rejected() {
    let t = T::new();
    let other = t
        .env
        .register_stellar_asset_contract_v2(Address::generate(&t.env))
        .address();
    let mut terms = t.terms(Mode::FullEscrow, TOTAL, 0);
    terms.token = other;
    assert_eq!(
        contract_err(t.c().try_create_and_fund(&t.id(1), &t.buyer, &terms)),
        Error::TokenNotAllowed
    );
}

#[test]
fn zero_or_negative_amount_rejected() {
    let t = T::new();
    for amt in [0i128, -1, -TOTAL] {
        assert_eq!(
            contract_err(t.c().try_create_and_fund(
                &t.id(1),
                &t.buyer,
                &t.terms(Mode::FullEscrow, amt, 0)
            )),
            Error::InvalidAmount
        );
    }
}

#[test]
fn unauthorized_arbiter_rejected() {
    let t = T::new();
    let mut terms = t.terms(Mode::FullEscrow, TOTAL, 0);
    terms.arbiter = Address::generate(&t.env);
    assert_eq!(
        contract_err(t.c().try_create_and_fund(&t.id(1), &t.buyer, &terms)),
        Error::ArbiterNotAllowed
    );
}

#[test]
fn invalid_participants_rejected() {
    let t = T::new();
    let mut terms = t.terms(Mode::FullEscrow, TOTAL, 0);
    terms.importer = t.buyer.clone();
    assert_eq!(
        contract_err(t.c().try_create_and_fund(&t.id(1), &t.buyer, &terms)),
        Error::InvalidParticipants
    );
    // el árbitro no puede ser el comprador
    assert_eq!(
        contract_err(t.c().try_create_and_fund(
            &t.id(2),
            &t.arbiter,
            &t.terms(Mode::FullEscrow, TOTAL, 0)
        )),
        Error::InvalidParticipants
    );
}

#[test]
fn advance_validation() {
    let t = T::new();
    // anticipo mayor o igual al total
    for adv in [TOTAL, TOTAL + 1] {
        assert_eq!(
            contract_err(t.c().try_create_and_fund(
                &t.id(1),
                &t.buyer,
                &t.terms(Mode::PartialAdvance, TOTAL, adv)
            )),
            Error::InvalidAdvance
        );
    }
    // anticipo cero en modo parcial
    assert_eq!(
        contract_err(t.c().try_create_and_fund(
            &t.id(1),
            &t.buyer,
            &t.terms(Mode::PartialAdvance, TOTAL, 0)
        )),
        Error::InvalidAdvance
    );
    // anticipo sobre el tope global (90%)
    assert_eq!(
        contract_err(t.c().try_create_and_fund(
            &t.id(1),
            &t.buyer,
            &t.terms(Mode::PartialAdvance, TOTAL, TOTAL * 9 / 10 + 1)
        )),
        Error::InvalidAdvance
    );
    // justo en el tope: ok
    t.c().create_and_fund(
        &t.id(2),
        &t.buyer,
        &t.terms(Mode::PartialAdvance, TOTAL, TOTAL * 9 / 10),
    );
    // FULL con anticipo != 0
    assert_eq!(
        contract_err(t.c().try_create_and_fund(
            &t.id(3),
            &t.buyer,
            &t.terms(Mode::FullEscrow, TOTAL, 1)
        )),
        Error::ModeMismatch
    );
}

#[test]
fn advance_in_full_mode_rejected() {
    let t = T::new();
    let id = t.full(1);
    assert_eq!(
        contract_err(t.c().try_claim_advance(&id)),
        Error::AdvanceNotAllowed
    );
}

#[test]
fn terms_cannot_be_changed_after_funding() {
    // No existe ninguna función para cambiar términos. Re-financiar el mismo id
    // con otros términos falla y la orden conserva los originales.
    let t = T::new();
    let id = t.partial(1);
    let mut evil = t.terms(Mode::PartialAdvance, TOTAL, TOTAL * 9 / 10);
    evil.importer = Address::generate(&t.env);
    assert_eq!(
        contract_err(t.c().try_create_and_fund(&id, &t.buyer, &evil)),
        Error::OrderExists
    );
    let o = t.c().get_order(&id);
    assert_eq!(o.advance_amount, ADVANCE);
    assert_eq!(o.importer, t.importer);
}

#[test]
fn insufficient_balance_fails_atomically() {
    let t = T::new();
    let poor = Address::generate(&t.env);
    StellarAssetClient::new(&t.env, &t.token).mint(&poor, &(TOTAL - 1));
    let r = t
        .c()
        .try_create_and_fund(&t.id(1), &poor, &t.terms(Mode::FullEscrow, TOTAL, 0));
    assert!(r.is_err());
    assert!(!t.c().has_order(&t.id(1)));
    assert_eq!(t.bal(&poor), TOTAL - 1);
}

// ---------------------------------------------------------------------------
// Autorización
// ---------------------------------------------------------------------------

fn only_auth<'a>(
    t: &'a T,
    who: &'a Address,
    fn_name: &'a str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) -> [MockAuth<'a>; 1] {
    let inv = Box::leak(Box::new(MockAuthInvoke {
        contract: &t.escrow,
        fn_name,
        args,
        sub_invokes: &[],
    }));
    [MockAuth {
        address: who,
        invoke: inv,
    }]
}

#[test]
fn confirmation_by_third_party_importer_or_admin_fails() {
    let t = T::new();
    let id = t.full(1);
    let stranger = Address::generate(&t.env);
    for who in [&stranger, &t.importer, &t.admin, &t.arbiter] {
        let auths = only_auth(
            &t,
            who,
            "confirm_delivery_and_release",
            (id.clone(),).into_val(&t.env),
        );
        let r = t
            .c()
            .mock_auths(&auths)
            .try_confirm_delivery_and_release(&id);
        assert!(r.is_err(), "no debería poder confirmar");
    }
    assert_eq!(t.c().get_order(&id).status, Status::Funded);
    assert_eq!(t.bal(&t.escrow), TOTAL);
    // el comprador sí
    let auths = only_auth(
        &t,
        &t.buyer,
        "confirm_delivery_and_release",
        (id.clone(),).into_val(&t.env),
    );
    t.c().mock_auths(&auths).confirm_delivery_and_release(&id);
    assert_eq!(t.c().get_order(&id).status, Status::Settled);
}

#[test]
fn advance_claim_by_non_importer_fails() {
    let t = T::new();
    let id = t.partial(1);
    for who in [&t.buyer, &t.admin, &t.arbiter] {
        let auths = only_auth(&t, who, "claim_advance", (id.clone(),).into_val(&t.env));
        assert!(t.c().mock_auths(&auths).try_claim_advance(&id).is_err());
    }
    assert_eq!(t.bal(&t.escrow), TOTAL);
}

#[test]
fn fund_by_third_party_for_buyer_fails() {
    let t = T::new();
    let id = t.id(1);
    let terms = t.terms(Mode::FullEscrow, TOTAL, 0);
    let attacker = Address::generate(&t.env);
    let auths = only_auth(
        &t,
        &attacker,
        "create_and_fund",
        (id.clone(), t.buyer.clone(), terms.clone()).into_val(&t.env),
    );
    assert!(t
        .c()
        .mock_auths(&auths)
        .try_create_and_fund(&id, &t.buyer, &terms)
        .is_err());
    assert!(!t.c().has_order(&id));
}

#[test]
fn buyer_signature_over_different_terms_is_not_valid() {
    // El comprador autorizó advance=ADVANCE; el backend intenta enviar otro anticipo.
    let t = T::new();
    let id = t.id(1);
    let signed = t.terms(Mode::PartialAdvance, TOTAL, ADVANCE);
    let mut tampered = signed.clone();
    tampered.advance_amount = TOTAL * 9 / 10;
    let auths = only_auth(
        &t,
        &t.buyer,
        "create_and_fund",
        (id.clone(), t.buyer.clone(), signed).into_val(&t.env),
    );
    assert!(t
        .c()
        .mock_auths(&auths)
        .try_create_and_fund(&id, &t.buyer, &tampered)
        .is_err());
    assert!(!t.c().has_order(&id));
}

#[test]
fn dispute_by_non_participant_fails() {
    let t = T::new();
    let id = t.full(1);
    let stranger = Address::generate(&t.env);
    assert_eq!(
        contract_err(t.c().try_open_dispute(&id, &stranger, &t.h(2))),
        Error::NotParticipant
    );
    assert_eq!(
        contract_err(t.c().try_open_dispute(&id, &t.arbiter, &t.h(2))),
        Error::NotParticipant
    );
    // pasar la address del comprador sin su firma falla
    let auths = only_auth(
        &t,
        &stranger,
        "open_dispute",
        (id.clone(), t.buyer.clone(), t.h(2)).into_val(&t.env),
    );
    assert!(t
        .c()
        .mock_auths(&auths)
        .try_open_dispute(&id, &t.buyer, &t.h(2))
        .is_err());
}

#[test]
fn resolution_by_unauthorized_account_fails() {
    let t = T::new();
    let id = t.full(1);
    t.c().open_dispute(&id, &t.buyer, &t.h(2));
    let stranger = Address::generate(&t.env);
    for who in [&stranger, &t.admin, &t.buyer, &t.importer] {
        let auths = only_auth(
            &t,
            who,
            "resolve_dispute",
            (id.clone(), TOTAL, 0i128, t.h(3)).into_val(&t.env),
        );
        assert!(t
            .c()
            .mock_auths(&auths)
            .try_resolve_dispute(&id, &TOTAL, &0, &t.h(3))
            .is_err());
    }
    assert_eq!(t.c().get_order(&id).status, Status::Disputed);
    assert_eq!(t.bal(&t.escrow), TOTAL);
}

#[test]
fn cancel_requires_both_parties() {
    let t = T::new();
    let id = t.full(1);
    for who in [&t.buyer, &t.importer] {
        let auths = only_auth(
            &t,
            who,
            "cancel_by_agreement",
            (id.clone(),).into_val(&t.env),
        );
        assert!(t
            .c()
            .mock_auths(&auths)
            .try_cancel_by_agreement(&id)
            .is_err());
    }
    assert_eq!(t.c().get_order(&id).status, Status::Funded);
    // con ambas firmas
    let args: soroban_sdk::Vec<soroban_sdk::Val> = (id.clone(),).into_val(&t.env);
    let inv = MockAuthInvoke {
        contract: &t.escrow,
        fn_name: "cancel_by_agreement",
        args: args.clone(),
        sub_invokes: &[],
    };
    let b0 = t.bal(&t.buyer);
    t.c()
        .mock_auths(&[
            MockAuth {
                address: &t.buyer,
                invoke: &inv,
            },
            MockAuth {
                address: &t.importer,
                invoke: &inv,
            },
        ])
        .cancel_by_agreement(&id);
    assert!(t.has_event(Cancelled {
        order_id: id.clone(),
        refunded_to_buyer: TOTAL
    }));
    let o = t.c().get_order(&id);
    assert_eq!(o.status, Status::Cancelled);
    assert_eq!(o.buyer_refunded, TOTAL);
    assert_eq!(t.bal(&t.buyer), b0 + TOTAL);
}

// ---------------------------------------------------------------------------
// Disputas
// ---------------------------------------------------------------------------

#[test]
fn dispute_before_advance_blocks_advance_and_release() {
    let t = T::new();
    let id = t.partial(1);
    t.c().open_dispute(&id, &t.buyer, &t.h(2));
    assert!(t.has_event(DisputeOpened {
        order_id: id.clone(),
        opened_by: t.buyer.clone(),
        reason_hash: t.h(2),
        remaining_escrow: TOTAL
    }));
    assert_eq!(
        contract_err(t.c().try_claim_advance(&id)),
        Error::DisputeActive
    );
    assert_eq!(
        contract_err(t.c().try_confirm_delivery_and_release(&id)),
        Error::DisputeActive
    );
    assert_eq!(
        contract_err(t.c().try_cancel_by_agreement(&id)),
        Error::DisputeActive
    );
    assert_eq!(
        contract_err(t.c().try_open_dispute(&id, &t.importer, &t.h(3))),
        Error::DisputeActive
    );
    // reembolso total antes de anticipos
    let b0 = t.bal(&t.buyer);
    t.c().resolve_dispute(&id, &TOTAL, &0, &t.h(4));
    assert!(t.has_event(Refunded {
        order_id: id.clone(),
        amount: TOTAL
    }));
    assert_eq!(t.bal(&t.buyer), b0 + TOTAL);
    let o = t.c().get_order(&id);
    assert_eq!(o.buyer_refunded, TOTAL);
    assert_eq!(o.remaining_escrow, 0);
    assert_eq!(o.status, Status::Settled);
    t.assert_invariant(&id);
}

#[test]
fn dispute_after_advance_arbiter_splits_only_retained_balance() {
    // Escenario 3 de la guía.
    let t = T::new();
    let id = t.partial(1);
    t.c().claim_advance(&id);
    t.c().open_dispute(&id, &t.buyer, &t.h(2));
    assert_eq!(
        contract_err(t.c().try_confirm_delivery_and_release(&id)),
        Error::DisputeActive
    );
    // intentar devolver 1.200 (incluye el anticipo ya pagado) falla
    assert_eq!(
        contract_err(t.c().try_resolve_dispute(&id, &TOTAL, &0, &t.h(4))),
        Error::InvalidResolution
    );
    // suma menor al retenido falla
    assert_eq!(
        contract_err(t.c().try_resolve_dispute(&id, &(100 * UNIT), &0, &t.h(4))),
        Error::InvalidResolution
    );
    // negativos fallan aunque sumen
    assert_eq!(
        contract_err(
            t.c()
                .try_resolve_dispute(&id, &(400 * UNIT), &(-100 * UNIT), &t.h(4))
        ),
        Error::InvalidResolution
    );
    let b0 = t.bal(&t.buyer);
    t.c().resolve_dispute(&id, &(300 * UNIT), &0, &t.h(4));
    assert_eq!(t.env.auths()[0].0, t.arbiter);
    assert!(t.has_event(DisputeResolved {
        order_id: id.clone(),
        refund_to_buyer: 300 * UNIT,
        release_to_importer: 0,
        resolution_hash: t.h(4)
    }));
    assert_eq!(t.bal(&t.buyer), b0 + 300 * UNIT);
    assert_eq!(t.bal(&t.importer), ADVANCE);
    assert_eq!(t.bal(&t.escrow), 0);
    let o = t.c().get_order(&id);
    assert_eq!(o.buyer_refunded, 300 * UNIT);
    assert_eq!(o.seller_released, ADVANCE);
    assert_eq!(o.remaining_escrow, 0);
    t.assert_invariant(&id);
    // no se puede resolver dos veces
    assert_eq!(
        contract_err(t.c().try_resolve_dispute(&id, &0, &0, &t.h(4))),
        Error::InvalidState
    );
}

#[test]
fn partial_split_resolution_sums_exactly() {
    let t = T::new();
    let id = t.full(1);
    t.c().open_dispute(&id, &t.importer, &t.h(2));
    t.c()
        .resolve_dispute(&id, &(500 * UNIT), &(700 * UNIT), &t.h(4));
    assert_eq!(t.bal(&t.importer), 700 * UNIT);
    let o = t.c().get_order(&id);
    assert_eq!(o.buyer_refunded + o.seller_released, TOTAL);
    t.assert_invariant(&id);
}

#[test]
fn resolution_overflow_is_rejected() {
    let t = T::new();
    let id = t.full(1);
    t.c().open_dispute(&id, &t.buyer, &t.h(2));
    assert_eq!(
        contract_err(
            t.c()
                .try_resolve_dispute(&id, &i128::MAX, &i128::MAX, &t.h(4))
        ),
        Error::Overflow
    );
}

#[test]
fn resolve_without_dispute_fails() {
    let t = T::new();
    let id = t.full(1);
    assert_eq!(
        contract_err(t.c().try_resolve_dispute(&id, &TOTAL, &0, &t.h(4))),
        Error::InvalidState
    );
}

#[test]
fn cancel_after_advance_refunds_only_retained() {
    let t = T::new();
    let id = t.partial(1);
    t.c().claim_advance(&id);
    let b0 = t.bal(&t.buyer);
    t.c().cancel_by_agreement(&id);
    assert_eq!(t.bal(&t.buyer), b0 + 300 * UNIT);
    let o = t.c().get_order(&id);
    assert_eq!(o.buyer_refunded, 300 * UNIT);
    assert_eq!(o.seller_released, ADVANCE);
    assert_eq!(o.status, Status::Cancelled);
    t.assert_invariant(&id);
    assert_eq!(
        contract_err(t.c().try_cancel_by_agreement(&id)),
        Error::InvalidState
    );
    assert_eq!(
        contract_err(t.c().try_open_dispute(&id, &t.buyer, &t.h(2))),
        Error::InvalidState
    );
}

#[test]
fn late_delivery_does_not_auto_release() {
    let t = T::new();
    let id = t.full(1);
    t.env
        .ledger()
        .with_mut(|l| l.timestamp = NOW + 365 * 86_400);
    // El retraso no libera nada; el comprador sigue pudiendo disputar.
    assert_eq!(t.bal(&t.escrow), TOTAL);
    t.c().open_dispute(&id, &t.buyer, &t.h(2));
    assert_eq!(t.c().get_order(&id).status, Status::Disputed);
}

// ---------------------------------------------------------------------------
// Configuración / admin
// ---------------------------------------------------------------------------

#[test]
fn constructor_rejects_invalid_config() {
    let env = Env::default();
    let a = Address::generate(&env);
    let tok = Address::generate(&env);
    let arb = Address::generate(&env);
    for bps in [0u32, 10_000, 20_000] {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(
                ImportEscrowContract,
                (a.clone(), tok.clone(), arb.clone(), bps),
            )
        }));
        assert!(r.is_err());
    }
}

#[test]
fn arbiter_rotation_only_affects_new_orders() {
    let t = T::new();
    let id = t.full(1);
    let new_arb = Address::generate(&t.env);
    t.c().set_arbiter(&new_arb);
    assert_eq!(t.env.auths()[0].0, t.admin);
    assert_eq!(t.c().get_config().arbiter, new_arb);
    // la orden existente conserva su árbitro
    assert_eq!(t.c().get_order(&id).arbiter, t.arbiter);
    t.c().open_dispute(&id, &t.buyer, &t.h(2));
    let auths = only_auth(
        &t,
        &new_arb,
        "resolve_dispute",
        (id.clone(), TOTAL, 0i128, t.h(3)).into_val(&t.env),
    );
    assert!(t
        .c()
        .mock_auths(&auths)
        .try_resolve_dispute(&id, &TOTAL, &0, &t.h(3))
        .is_err());
    // nuevas órdenes deben usar el nuevo árbitro
    assert_eq!(
        contract_err(t.c().try_create_and_fund(
            &t.id(2),
            &t.buyer,
            &t.terms(Mode::FullEscrow, TOTAL, 0)
        )),
        Error::ArbiterNotAllowed
    );
}

#[test]
fn set_arbiter_by_non_admin_fails() {
    let t = T::new();
    let x = Address::generate(&t.env);
    let auths = only_auth(&t, &x, "set_arbiter", (x.clone(),).into_val(&t.env));
    assert!(t.c().mock_auths(&auths).try_set_arbiter(&x).is_err());
}

// ---------------------------------------------------------------------------
// TTL / persistencia
// ---------------------------------------------------------------------------

#[test]
fn order_ttl_is_extended_on_write_and_on_demand() {
    let t = T::new();
    let id = t.full(1);
    let ttl_of = |t: &T| {
        t.env.as_contract(&t.escrow, || {
            // La clave es DataKey::Order(id); se reconstruye con el mismo tipo.
            #[soroban_sdk::contracttype]
            enum DataKey {
                Config,
                Order(BytesN<32>),
            }
            let _ = DataKey::Config;
            t.env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Order(id.clone()))
        })
    };
    let ttl0 = ttl_of(&t);
    assert!(ttl0 >= 30 * 17_280, "ttl inicial {}", ttl0);
    // avanzar ~100 días: queda por debajo del umbral
    t.env.ledger().with_mut(|l| {
        l.sequence_number += 100 * 17_280;
        l.timestamp += 100 * 86_400;
    });
    let ttl1 = ttl_of(&t);
    assert!(ttl1 < ttl0);
    t.c().extend_ttl(&id);
    let ttl2 = ttl_of(&t);
    assert!(ttl2 > ttl1);
    // la orden sigue accesible y operable
    t.c().confirm_delivery_and_release(&id);
    assert_eq!(t.c().get_order(&id).status, Status::Settled);
}

// ---------------------------------------------------------------------------
// Secuencias aleatorias: invariantes
// ---------------------------------------------------------------------------

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

#[test]
fn random_operation_sequences_preserve_invariants() {
    for seed in 1..=25u64 {
        let t = T::new();
        StellarAssetClient::new(&t.env, &t.token).mint(&t.buyer, &(1_000_000 * UNIT));
        let mut rng = Lcg(seed);
        let ids: std::vec::Vec<BytesN<32>> = (0..6u8).map(|n| t.id(n)).collect();
        let initial_supply = t.bal(&t.buyer);
        for _ in 0..60 {
            let id = &ids[(rng.next() % ids.len() as u64) as usize];
            match rng.next() % 7 {
                0 => {
                    let total = (rng.next() % 5_000 + 1) as i128 * UNIT;
                    let partial = rng.next() % 2 == 0;
                    let adv = if partial {
                        (total * ((rng.next() % 9_000) as i128 + 1)) / 10_000
                    } else {
                        0
                    };
                    let mode = if partial && adv > 0 {
                        Mode::PartialAdvance
                    } else {
                        Mode::FullEscrow
                    };
                    let adv = if mode == Mode::FullEscrow { 0 } else { adv };
                    let _ = t
                        .c()
                        .try_create_and_fund(id, &t.buyer, &t.terms(mode, total, adv));
                }
                1 => {
                    let _ = t.c().try_claim_advance(id);
                }
                2 => {
                    let _ = t.c().try_confirm_delivery_and_release(id);
                }
                3 => {
                    let who = if rng.next() % 2 == 0 {
                        &t.buyer
                    } else {
                        &t.importer
                    };
                    let _ = t.c().try_open_dispute(id, who, &t.h(2));
                }
                4 => {
                    if let Ok(Ok(o)) = t.c().try_get_order(id) {
                        let r = o.remaining_escrow;
                        let refund = if r > 0 {
                            (rng.next() as i128) % (r + 1)
                        } else {
                            0
                        };
                        // a veces una resolución inválida
                        let release = if rng.next() % 4 == 0 {
                            r - refund + 1
                        } else {
                            r - refund
                        };
                        let _ = t.c().try_resolve_dispute(id, &refund, &release, &t.h(3));
                    }
                }
                5 => {
                    let _ = t.c().try_cancel_by_agreement(id);
                }
                _ => {
                    let _ = t.c().try_extend_ttl(id);
                }
            }
            // invariantes globales
            let mut retained = 0i128;
            for i in &ids {
                if let Ok(Ok(o)) = t.c().try_get_order(i) {
                    assert_eq!(
                        o.amount_total,
                        o.seller_released + o.buyer_refunded + o.remaining_escrow
                    );
                    assert!(o.advance_released <= o.advance_amount);
                    assert!(o.remaining_escrow >= 0);
                    if matches!(o.status, Status::Settled | Status::Cancelled) {
                        assert_eq!(o.remaining_escrow, 0);
                    }
                    if o.mode == Mode::FullEscrow {
                        assert_eq!(o.advance_released, 0);
                    }
                    retained += o.remaining_escrow;
                }
            }
            assert_eq!(
                t.bal(&t.escrow),
                retained,
                "saldo del contrato == suma retenida"
            );
            assert_eq!(
                t.bal(&t.buyer) + t.bal(&t.importer) + t.bal(&t.escrow),
                initial_supply,
                "conservación de fondos"
            );
        }
    }
}
