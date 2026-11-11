"use client";

import { validFactType, type FactType } from "./fact-type";

export default function FactTypePicker({ value, disabled, onChange, name }: {
  value?: FactType;
  disabled?: boolean;
  onChange: (factType: FactType) => void;
  name?: string;
}) {
  return <label className="fact-type-picker">
    <span>Save as</span>
    <select aria-label={`Memory type${name ? ` for ${name}` : ""}`} value={value === "profile" ? "profile" : "timeline"} disabled={disabled}
      onChange={event => { if (validFactType(event.target.value)) onChange(event.target.value); }}>
      <option value="profile">Profile fact</option>
      <option value="timeline">Timeline event</option>
    </select>
  </label>;
}
