import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './AppContext';
import { Layout } from './components/Layout';
import { LoginPage } from './features/auth/LoginPage';
import { HomePage } from './features/home/HomePage';
import { HistoryPage } from './features/audit/HistoryPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { MastersPage } from './features/masters/MastersPage';
import { CustomerForm } from './features/masters/CustomerForm';
import { ProductForm } from './features/masters/ProductForm';
import { RawMaterialForm } from './features/masters/RawMaterialForm';
import { OrdersPage } from './features/orders/OrdersPage';
import { JobOrderPage } from './features/orders/JobOrderPage';

function Gate() {
  const { authReady, user, t, workspaceError, logout } = useApp();

  if (!authReady) {
    return (
      <main className="center">
        <p className="muted">{t('loading')}</p>
      </main>
    );
  }
  if (!user) return <LoginPage />;
  if (workspaceError) {
    return (
      <main className="center">
        <div className="card">
          <h2>{t('errorTitle')}</h2>
          <p className="error">{workspaceError}</p>
          <button className="secondary" onClick={() => void logout()}>
            {t('signOut')}
          </button>
        </div>
      </main>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:id" element={<JobOrderPage />} />
        <Route path="masters" element={<MastersPage />} />
        <Route path="masters/products/:id" element={<ProductForm />} />
        <Route path="masters/raw-materials/:id" element={<RawMaterialForm />} />
        <Route path="masters/customers/:id" element={<CustomerForm />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Gate />
      </HashRouter>
    </AppProvider>
  );
}
