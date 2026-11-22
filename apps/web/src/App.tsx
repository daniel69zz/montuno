import { Route, Routes } from 'react-router-dom';
import { Page, Shell } from './components/ui';
import { Account } from './pages/Account';
import { Admin } from './pages/Admin';
import { ImporterHome, ImporterRegister, QuoteWizard } from './pages/Importer';
import { Catalog, CatalogItemPage, ProviderPage, Providers } from './pages/Catalog';
import { Checkout } from './pages/Checkout';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';
import { useSession } from './lib/session';

export function App() {
  const s = useSession();
  return (
    <Shell>
      {s.configError && <div className="wrap" style={{ paddingTop: 24 }}><div className="note" role="alert">{s.configError} ¿Está corriendo la API en :3000?</div></div>}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/entrar" element={<Login />} />
        <Route path="/catalogo" element={<Catalog />} />
        <Route path="/catalogo/:id" element={<CatalogItemPage />} />
        <Route path="/proveedores" element={<Providers />} />
        <Route path="/proveedores/:id" element={<ProviderPage />} />
        <Route path="/c/:token" element={<Checkout />} />
        <Route path="/pedidos" element={<Orders />} />
        <Route path="/pedidos/:id" element={<OrderDetail />} />
        <Route path="/cuenta" element={<Account />} />
        <Route path="/importadora" element={<ImporterHome />} />
        <Route path="/importadora/registro" element={<ImporterRegister />} />
        <Route path="/importadora/cotizar" element={<QuoteWizard />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Page eyebrow="404" title="Esta cima no existe." />} />
      </Routes>
    </Shell>
  );
}
