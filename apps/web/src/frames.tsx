import { Outlet } from "react-router";
import { DemoBanner } from "./demo/DemoBanner";

/** Guest pages: the demo banner (Plum Salon look) above the page. */
export function GuestFrame() {
  return (
    <>
      <DemoBanner surface="guest" />
      <Outlet />
    </>
  );
}

/** Staff pages: a full-height column with the demo banner (staff look) above the screen. */
export function StaffFrame() {
  return (
    <div className="theme-staff flex h-dvh flex-col">
      <DemoBanner surface="staff" />
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
