import type { IecUnit } from "@/lib/emu/types";
import { IEC_UNITS } from "@/lib/emu/types";

interface Props {
  value: IecUnit;
  onChange: (unit: IecUnit) => void;
  compact?: boolean;
  label?: string;
}

export function IecUnitSeg({ value, onChange, compact, label = "IEC drive unit" }: Props) {
  return (
    <div
      className={compact ? "g64-seg g64-seg-inline" : "g64-seg"}
      role="group"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      {IEC_UNITS.map((unit) => (
        <button key={unit} type="button" data-on={value === unit} onClick={() => onChange(unit)}>
          {unit}
        </button>
      ))}
    </div>
  );
}
