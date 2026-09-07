import { useEffect, useState } from "react";
import { readBuildId } from "@/lib/emu/build-id";

/** Always-visible cache check — short git SHA and hashed routes id. */
export function BuildId({ className = "g64-buildid" }: { className?: string }) {
  const [label, setLabel] = useState(() => readBuildId().label);
  useEffect(() => {
    const sync = () => setLabel(readBuildId().label);
    sync();
    const t = window.setTimeout(sync, 400);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <span className={className} title="Build id — confirm this is not a cached build" data-g64-build={label}>
      {label}
    </span>
  );
}
