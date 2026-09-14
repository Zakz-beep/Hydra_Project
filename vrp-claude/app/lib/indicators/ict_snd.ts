import type { ChartData } from '../../components/lwc/core/TerminalChart';
import type { ICTSeekAndDestroyConfig } from '../../types/indicators';
import type { Drawing } from '../../components/lwc/core/TerminalDrawingOverlay';

export interface ICTStats {
    totalDays: number;
    sndDays: number;
    warnDays: number;
}

export function calcICTSndProfile(data: ChartData[], cfg: ICTSeekAndDestroyConfig): { drawings: Drawing[], stats: ICTStats } {
    const drawings: Drawing[] = [];
    const stats: ICTStats = { totalDays: 0, sndDays: 0, warnDays: 0 };
    if (!data || data.length === 0 || !cfg.enabled) return { drawings, stats };

    // Helpers
    const getNyTime = (unixSeconds: number) => {
        const d = new Date(unixSeconds * 1000);
        return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
    };

    const inSession = (nyTime: string, sessionStr: string) => {
        const parts = sessionStr.split('-');
        if (parts.length !== 2) return false;
        const start = parts[0];
        const end = parts[1];
        if (start > end) {
            return nyTime >= start || nyTime < end;
        }
        return nyTime >= start && nyTime < end;
    };

    // Session State Tracking
    interface SessionState {
        isActive: boolean;
        high: number;
        low: number;
        startTime: number;
        endTime: number;
        drawn: boolean;
    }

    let as: SessionState = { isActive: false, high: -Infinity, low: Infinity, startTime: 0, endTime: 0, drawn: false };
    let lo: SessionState = { isActive: false, high: -Infinity, low: Infinity, startTime: 0, endTime: 0, drawn: false };
    let ny: SessionState = { isActive: false, high: -Infinity, low: Infinity, startTime: 0, endTime: 0, drawn: false };

    // To track daily S&D status, we group by "Day" (from NY 17:00 to 17:00 or similar, but easiest is to evaluate S&D at the end of NY session)
    // S&D uses AS, LO, and NY of the *same* cycle.
    
    let cycleId = 0; // increments when a new AS session starts

    const addBox = (s: SessionState, color: string, idPrefix: string) => {
        if (!s.drawn && s.startTime > 0 && s.endTime > 0 && s.high !== -Infinity && s.low !== Infinity) {
            let label = '';
            if (idPrefix === 'as') label = 'Asia Session';
            else if (idPrefix === 'lo') label = 'London Session';
            else if (idPrefix === 'ny') label = 'New York Session';

            drawings.push({
                id: `ict_${idPrefix}_${cycleId}_${s.startTime}`,
                type: 'rectangle',
                startTime: s.startTime,
                endTime: s.endTime,
                startPrice: s.high,
                endPrice: s.low,
                color: color,
                label: label,
                textPosition: 'top_left',
            });
            s.drawn = true;
        }
    };

    const evaluateSnd = (nyClose: number) => {
        if (lo.high === -Infinity || lo.low === Infinity || ny.high === -Infinity || ny.low === Infinity) return;
        
        let c1 = ny.high <= lo.high && ny.low >= lo.low; // Inside day
        let c2 = ny.high > lo.high && ny.low < lo.low;   // Outside day
        let c3 = nyClose <= lo.high && nyClose >= lo.low; // Close in LO
        let c4 = (lo.high - lo.low) <= cfg.sdLimit;

        let isSnd = true;
        if (cfg.crtInsideDay && !c1) isSnd = false;
        if (cfg.crtOutsideDay && !c2) isSnd = false;
        if (cfg.crtCloseInLo && !c3) isSnd = false;
        if (cfg.crtSdLimit && !c4) isSnd = false;

        // If user unchecked some, it means we don't strictly require it. 
        // Wait, the PineScript says:
        // bool c1 = ... bool c2 = ...
        // is_snd := (not crt_inside_day or c1) and (not crt_outside_day or c2) ...
        // We'll mimic this:
        isSnd = (!cfg.crtInsideDay || c1) && 
                (!cfg.crtOutsideDay || c2) && 
                (!cfg.crtCloseInLo || c3) && 
                (!cfg.crtSdLimit || c4);
        
        stats.totalDays++;
        if (isSnd) {
            stats.sndDays++;
            if (cfg.showSndDay) {
                drawings.push({
                    id: `ict_lbl_${cycleId}`,
                    type: 'label',
                    startTime: ny.endTime,
                    startPrice: ny.high,
                    endTime: ny.endTime,
                    endPrice: ny.high,
                    color: cfg.sndDayColor,
                    label: 'S&D',
                    textPosition: 'top_center'
                });
            }
        }
    };

    for (let i = 0; i < data.length; i++) {
        const bar = data[i];
        const nyTime = getNyTime(bar.time as number);
        
        const isAs = inSession(nyTime, cfg.asSession);
        const isLo = inSession(nyTime, cfg.loSession);
        const isNy = inSession(nyTime, cfg.nySession);

        // Asia Session
        if (isAs && !as.isActive) {
            // New AS session -> new cycle
            cycleId++;
            as = { isActive: true, high: bar.high, low: bar.low, startTime: bar.time as number, endTime: bar.time as number, drawn: false };
            lo = { isActive: false, high: -Infinity, low: Infinity, startTime: 0, endTime: 0, drawn: false };
            ny = { isActive: false, high: -Infinity, low: Infinity, startTime: 0, endTime: 0, drawn: false };
        } else if (isAs) {
            as.high = Math.max(as.high, bar.high);
            as.low = Math.min(as.low, bar.low);
            as.endTime = bar.time as number;
        } else if (!isAs && as.isActive) {
            as.isActive = false;
            addBox(as, cfg.asColor, 'as');
        }

        // London Session
        if (isLo && !lo.isActive) {
            lo = { isActive: true, high: bar.high, low: bar.low, startTime: bar.time as number, endTime: bar.time as number, drawn: false };
        } else if (isLo) {
            lo.high = Math.max(lo.high, bar.high);
            lo.low = Math.min(lo.low, bar.low);
            lo.endTime = bar.time as number;
        } else if (!isLo && lo.isActive) {
            lo.isActive = false;
            addBox(lo, cfg.loColor, 'lo');
        }

        // NY Session
        if (isNy && !ny.isActive) {
            ny = { isActive: true, high: bar.high, low: bar.low, startTime: bar.time as number, endTime: bar.time as number, drawn: false };
        } else if (isNy) {
            ny.high = Math.max(ny.high, bar.high);
            ny.low = Math.min(ny.low, bar.low);
            ny.endTime = bar.time as number;
        } else if (!isNy && ny.isActive) {
            ny.isActive = false;
            addBox(ny, cfg.nyColor, 'ny');
            evaluateSnd(bar.close);
        }
    }

    // Flush active boxes at the end
    if (as.isActive) addBox(as, cfg.asColor, 'as');
    if (lo.isActive) addBox(lo, cfg.loColor, 'lo');
    if (ny.isActive) {
        addBox(ny, cfg.nyColor, 'ny');
        evaluateSnd(data[data.length - 1].close);
    }

    return { drawings, stats };
}
