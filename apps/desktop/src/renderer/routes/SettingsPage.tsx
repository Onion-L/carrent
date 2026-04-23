import { Settings, Monitor, Palette, Activity, FolderOpen } from "lucide-react";
import { currentProject } from "../mock/uiShellData";

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#888]" />
        <h2 className="text-[14px] font-semibold text-[#ddd]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[13px] text-[#aaa]">{label}</span>
      <span className="text-[13px] text-[#888]">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-[#2a2a2a]" />;
}

export function SettingsPage() {
  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-[#181818]">
      <div className="mx-auto w-full max-w-2xl p-6">
        <div className="drag-region mb-6 flex items-center gap-2">
          <Settings className="h-5 w-5 text-[#888]" />
          <h1 className="text-[18px] font-semibold text-[#eee]">Settings</h1>
        </div>

        <div className="space-y-4">
          {/* Workspace */}
          <SectionCard title="Workspace" icon={FolderOpen}>
            <Field label="Current project" value={currentProject.name} />
            <Divider />
            <Field label="Project path" value={currentProject.path} />
            <Divider />
            <Field label="Auto-detect runtimes" value="Enabled" />
          </SectionCard>

          {/* Interface */}
          <SectionCard title="Interface" icon={Palette}>
            <Field label="Theme" value="Dark" />
            <Divider />
            <Field label="Font size" value="14px" />
            <Divider />
            <Field label="Sidebar width" value="240px" />
          </SectionCard>

          {/* Diagnostics */}
          <SectionCard title="Diagnostics" icon={Activity}>
            <Field label="Version" value="v0.1.0" />
            <Divider />
            <Field label="Desktop shell" value="Active" />
            <Divider />
            <div className="flex items-center justify-between py-2">
              <span className="text-[13px] text-[#aaa]">Runtime connections</span>
              <span className="inline-flex items-center gap-1 text-[13px] text-emerald-400">
                <Monitor className="h-3 w-3" />1 connected
              </span>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
