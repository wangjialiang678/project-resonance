import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import AppRoutes from "./AppRoutes";

export default function AppShell() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/*" element={<AppRoutes />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
