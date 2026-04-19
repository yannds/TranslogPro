import { useEffect, useState } from 'react';
import * as Network from 'expo-network';

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const s = await Network.getNetworkStateAsync();
        if (active) setOnline(!!s.isConnected && s.isInternetReachable !== false);
      } catch {
        if (active) setOnline(false);
      }
    }
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => { active = false; clearInterval(id); };
  }, []);
  return online;
}
