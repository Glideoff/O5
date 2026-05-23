import { Outlet } from "react-router-dom";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { UpdateBanner } from "./UpdateBanner";
import { ClassificationBanner } from "./institutional/ClassificationBanner";
import { SessionBar } from "./institutional/SessionBar";
import { DocumentHeader } from "./institutional/DocumentHeader";
import { SurveillanceBridge } from "./institutional/SurveillanceBridge";
import "../styles/layout.css";
import "../styles/institutional.css";

export function Layout() {
  return (
    <div className="overseer-shell">
      <ClassificationBanner position="top" />
      <SessionBar />
      <Topbar />
      <UpdateBanner />
      <Sidebar />
      <main className="overseer-main">
        <DocumentHeader />
        <Outlet />
      </main>
      <ClassificationBanner position="bottom" />
      <SurveillanceBridge />
    </div>
  );
}
