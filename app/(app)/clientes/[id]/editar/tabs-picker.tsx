"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { CLIENT_TABS, type HiddenTabs, isTabHidden, type TabKey, type TabZone } from "@/lib/client-tabs";
import { SHOW_TASKS } from "@/lib/tasks";
import { setClientTab } from "../../actions";

type Change = { zone: TabZone; tab: TabKey; visible: boolean };

// Qué solapas ve el equipo y cuáles la cuenta del cliente. Se guarda al tocar.
export function TabsPicker({ clientId, hiddenTabs }: { clientId: string; hiddenTabs: HiddenTabs }) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [hidden, apply] = useOptimistic(hiddenTabs, (state, { zone, tab, visible }: Change) => ({
    ...state,
    [zone]: visible ? state[zone].filter((k) => k !== tab) : [...state[zone], tab],
  }));

  const tabs = CLIENT_TABS.filter((t) => SHOW_TASKS || t.key !== "tareas");

  function toggle(zone: TabZone, tab: TabKey) {
    setError(null);
    const visible = isTabHidden(hidden, zone, tab);
    startTransition(async () => {
      apply({ zone, tab, visible });
      const result = await setClientTab(clientId, zone, tab, visible);
      if (!result.ok) setError(result.error);
    });
  }

  const cell = (zone: TabZone, tab: TabKey, label: string) => {
    const on = !isTabHidden(hidden, zone, tab);
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label}: ${zone === "team" ? "equipo" : "cliente"}`}
        className={`toggle${on ? " on" : ""}`}
        onClick={() => toggle(zone, tab)}
      />
    );
  };

  return (
    <Card title="Solapas" hint="Vista general siempre se ve">
      <div className="tabs-picker">
        <div className="tabs-picker-row head">
          <span>Solapa</span>
          <span>Equipo</span>
          <span>Cliente</span>
        </div>
        {tabs.map((t) => (
          <div key={t.key} className="tabs-picker-row">
            <b>{t.team}</b>
            <span>{cell("team", t.key, t.team)}</span>
            <span>{t.client ? cell("client", t.key, t.team) : <em>No aplica</em>}</span>
          </div>
        ))}
      </div>
      <p className="tabs-picker-note">
        En la cuenta del cliente, META, CRM, WEB, Portal y Reuniones aparecen solo si además la integración está conectada.
      </p>
      {error && <p className="form-error form-msg">{error}</p>}
    </Card>
  );
}
