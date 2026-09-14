import type { ChartData } from '../../components/lwc/core/TerminalChart';
import type { SessionsConfig, SessionItem } from '../../types/indicators';
import type { Drawing } from '../../components/lwc/core/TerminalDrawingOverlay';

export function calcSessionsProfile(data: ChartData[], cfg: SessionsConfig): Drawing[] {
    const drawings: Drawing[] = [];
    if (!data || data.length === 0 || !cfg.enabled) return drawings;

    // Time Zone helper - convert to NY Time
    const getNyTime = (unixSeconds: number) => {
        const d = new Date(unixSeconds * 1000);
        return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
    };

    // Check if time is in session
    const inSession = (nyTime: string, sessionStr: string) => {
        const parts = sessionStr.split('-');
        if (parts.length !== 2) return false;
        const start = parts[0].trim();
        const end = parts[1].trim();
        if (start > end) {
            return nyTime >= start || nyTime < end;
        }
        return nyTime >= start && nyTime < end;
    };

    // Active session state tracking
    interface SessionState {
        isActive: boolean;
        high: number;
        low: number;
        startTime: number;
        endTime: number;
        cycleId: number;
    }

    // Initialize state for each enabled session item
    const statesMap = new Map<string, SessionState>();
    cfg.items.forEach(item => {
        if (item.enabled && item.timeRange) {
            statesMap.set(item.id, {
                isActive: false,
                high: -Infinity,
                low: Infinity,
                startTime: 0,
                endTime: 0,
                cycleId: 0
            });
        }
    });

    const addBox = (item: SessionItem, s: SessionState) => {
        if (s.startTime > 0 && s.endTime > 0 && s.high !== -Infinity && s.low !== Infinity) {
            drawings.push({
                // Prepend with 'ict_' so TerminalDrawingOverlay applies the ultra-smooth transparent background styles!
                id: `ict_custom_${item.id}_${s.cycleId}_${s.startTime}`,
                type: 'rectangle',
                startTime: s.startTime,
                endTime: s.endTime,
                startPrice: s.high,
                endPrice: s.low,
                color: item.color,
                label: cfg.showLabels ? item.name : undefined,
                textPosition: 'top_left',
                lineWidth: cfg.showBorders ? 1.5 : 0.001, // extremely thin or invisible border if borders disabled
            });
        }
    };

    // Process bars
    for (let i = 0; i < data.length; i++) {
        const bar = data[i];
        const nyTime = getNyTime(bar.time as number);

        cfg.items.forEach(item => {
            const state = statesMap.get(item.id);
            if (!state) return;

            const inSes = inSession(nyTime, item.timeRange);

            if (inSes) {
                if (!state.isActive) {
                    // New session block starts
                    state.isActive = true;
                    state.cycleId++;
                    state.startTime = bar.time as number;
                    state.high = bar.high;
                    state.low = bar.low;
                } else {
                    // Continue active session block
                    state.high = Math.max(state.high, bar.high);
                    state.low = Math.min(state.low, bar.low);
                }
                state.endTime = bar.time as number;
            } else {
                if (state.isActive) {
                    // Session block ends -> draw it
                    state.isActive = false;
                    addBox(item, state);
                    // Reset
                    state.startTime = 0;
                    state.endTime = 0;
                    state.high = -Infinity;
                    state.low = Infinity;
                }
            }
        });
    }

    // Flush any remaining active sessions at the end of data
    cfg.items.forEach(item => {
        const state = statesMap.get(item.id);
        if (state && state.isActive) {
            addBox(item, state);
        }
    });

    return drawings;
}
