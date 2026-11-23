// Persisted choices (appearance, location) shared by the whole UI.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { getLocation } from "./core/locations";
import type { Location } from "./core/types";
import { KEYS, load, save } from "./data/storage";
import { DARK, LIGHT, type Tokens } from "./theme/tokens";

export type ThemeChoice = "auto" | "light" | "dark";

interface Settings {
  ready: boolean;
  tokens: Tokens;
  themeChoice: ThemeChoice;
  setThemeChoice: (c: ThemeChoice) => void;
  location: Location;
  setLocationId: (id: string) => void;
}

const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [ready, setReady] = useState(false);
  const [themeChoice, setThemeState] = useState<ThemeChoice>("auto");
  const [locationId, setLocationState] = useState("christchurch");

  useEffect(() => {
    let alive = true;
    (async () => {
      const [t, l] = await Promise.all([load(KEYS.theme), load(KEYS.location)]);
      if (!alive) return;
      if (t === "light" || t === "dark") setThemeState(t);
      if (l) setLocationState(getLocation(l).id);
      setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  const setThemeChoice = useCallback((c: ThemeChoice) => {
    setThemeState(c);
    save(KEYS.theme, c);
  }, []);
  const setLocationId = useCallback((id: string) => {
    setLocationState(id);
    save(KEYS.location, id);
  }, []);

  const value = useMemo<Settings>(() => {
    const dark = themeChoice === "dark" || (themeChoice === "auto" && system === "dark");
    return {
      ready, themeChoice, setThemeChoice, setLocationId,
      tokens: dark ? DARK : LIGHT,
      location: getLocation(locationId),
    };
  }, [ready, themeChoice, system, locationId, setThemeChoice, setLocationId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used inside <SettingsProvider>");
  return v;
}
