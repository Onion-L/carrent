import { SidebarNav } from "./SidebarNav";

export function DesktopShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#181818]">
      <SidebarNav />
      <main className="flex min-w-0 flex-1">{children}</main>
    </div>
  );
}
