import { Monitor, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { runtimes } from "../mock/uiShellData";

function StatusBadge({ status }: { status: "detected" | "unavailable" | "unknown" }) {
  const config = {
    detected: {
      icon: CheckCircle2,
      label: "Detected",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    },
    unavailable: {
      icon: XCircle,
      label: "Unavailable",
      className: "border-red-500/20 bg-red-500/10 text-red-400",
    },
    unknown: {
      icon: HelpCircle,
      label: "Unknown",
      className: "border-[#444] bg-[#252525] text-[#888]",
    },
  };

  const { icon: Icon, label, className } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function RuntimesPage() {
  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-[#181818]">
      <div className="mx-auto w-full max-w-3xl p-6">
        <div className="mb-6">
          <h1 className="text-[18px] font-semibold text-[#eee]">Runtimes</h1>
          <p className="mt-1 text-[13px] text-[#666]">
            Detected local CLI runtimes that can be bound to agents.
          </p>
        </div>

        {runtimes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] py-16 text-[#555]">
            <Monitor className="h-10 w-10" />
            <p className="text-[15px]">No runtimes detected</p>
            <p className="max-w-sm text-center text-[13px]">
              Carrent will scan for local CLI tools here. Install a supported runtime to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {runtimes.map((rt) => (
              <div
                key={rt.id}
                className="flex items-start justify-between rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#252525]">
                    <Monitor className="h-4 w-4 text-[#888]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-[#ddd]">
                        {rt.name}
                      </span>
                      <StatusBadge status={rt.status} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#666]">
                      <span>
                        <span className="text-[#555]">Path:</span> {rt.path}
                      </span>
                      <span>
                        <span className="text-[#555]">Version:</span> {rt.version}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-[#555]">
                      {rt.status === "detected"
                        ? "Can be assigned to agents"
                        : "Not available for binding"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
