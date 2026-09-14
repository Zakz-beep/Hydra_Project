'use client';

import React from 'react';
import type { TerminalTheme } from './TerminalThemes';

export type DrawingTool = 'cursor' | 'trendline' | 'horizontal_line' | 'fibonacci' | 'rectangle' | 'long_position' | 'short_position' | 'measure' | 'anchored_volume_profile';

interface TerminalSidebarProps {
    activeTool: DrawingTool;
    onToolChange: (tool: DrawingTool) => void;
    onClearAll: () => void;
    onToggleObjectTree: () => void;
    showObjectTree: boolean;
    drawingCount: number;
    theme: TerminalTheme;
}

interface ToolButton {
    id: DrawingTool;
    label: string;
    icon: React.ReactNode;
}

function CursorIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
            <line x1="15" y1="15" x2="21" y2="21" />
        </svg>
    );
}

function TrendlineIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="20" x2="20" y2="4" />
            <circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none" />
        </svg>
    );
}

function HorizontalLineIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
    );
}

function FibonacciIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="4" x2="21" y2="4" />
            <line x1="3" y1="9" x2="21" y2="9" strokeDasharray="3 2" />
            <line x1="3" y1="13" x2="21" y2="13" strokeDasharray="3 2" />
            <line x1="3" y1="17" x2="21" y2="17" strokeDasharray="3 2" />
            <line x1="3" y1="20" x2="21" y2="20" />
            <text x="1" y="3.5" fontSize="3.5" fill="currentColor" stroke="none" fontFamily="monospace">0</text>
            <text x="0" y="8.5" fontSize="3.5" fill="currentColor" stroke="none" fontFamily="monospace">.236</text>
            <text x="0" y="12.5" fontSize="3.5" fill="currentColor" stroke="none" fontFamily="monospace">.618</text>
            <text x="1" y="19.5" fontSize="3.5" fill="currentColor" stroke="none" fontFamily="monospace">1</text>
        </svg>
    );
}

function RectangleIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="6" width="16" height="12" rx="1" />
        </svg>
    );
}

function MeasureIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21L3 3L21 3" />
            <line x1="3" y1="8" x2="6" y2="8" />
            <line x1="3" y1="13" x2="6" y2="13" />
            <line x1="3" y1="18" x2="5" y2="18" />
            <line x1="8" y1="3" x2="8" y2="6" />
            <line x1="13" y1="3" x2="13" y2="6" />
            <line x1="18" y1="3" x2="18" y2="5" />
            <line x1="7" y1="17" x2="19" y2="5" strokeDasharray="3 2" />
        </svg>
    );
}

function LongPositionIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="8" rx="0.5" fill="currentColor" fillOpacity="0.2" stroke="currentColor" />
            <rect x="4" y="12" width="16" height="8" rx="0.5" fill="none" stroke="currentColor" strokeDasharray="2 2" />
            <path d="M12 16V8M12 8L9 11M12 8l3 3" />
        </svg>
    );
}

function ShortPositionIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="12" width="16" height="8" rx="0.5" fill="currentColor" fillOpacity="0.2" stroke="currentColor" />
            <rect x="4" y="4" width="16" height="8" rx="0.5" fill="none" stroke="currentColor" strokeDasharray="2 2" />
            <path d="M12 8v8M12 16l-3-3M12 16l3-3" />
        </svg>
    );
}

function AVPIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="6" width="10" height="3" fill="currentColor" fillOpacity="0.2" stroke="none" />
            <rect x="4" y="10" width="16" height="3" fill="currentColor" fillOpacity="0.5" stroke="none" />
            <rect x="4" y="14" width="8" height="3" fill="currentColor" fillOpacity="0.2" stroke="none" />
            <line x1="4" y1="4" x2="4" y2="20" strokeWidth="2" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
        </svg>
    );
}

const TOOLS: ToolButton[] = [
    { id: 'cursor', label: 'Cursor', icon: <CursorIcon /> },
    { id: 'trendline', label: 'Trendline', icon: <TrendlineIcon /> },
    { id: 'horizontal_line', label: 'Horizontal Line', icon: <HorizontalLineIcon /> },
    { id: 'fibonacci', label: 'Fibonacci', icon: <FibonacciIcon /> },
    { id: 'rectangle', label: 'Rectangle', icon: <RectangleIcon /> },
    { id: 'long_position', label: 'Long Position', icon: <LongPositionIcon /> },
    { id: 'short_position', label: 'Short Position', icon: <ShortPositionIcon /> },
    { id: 'measure', label: 'Measure', icon: <MeasureIcon /> },
    { id: 'anchored_volume_profile', label: 'Anchored Vol Profile', icon: <AVPIcon /> },
];

// Groups: 0=cursor | 1=drawings | 2=positions | 3=measure
const TOOL_GROUPS: DrawingTool[][] = [
    ['cursor'],
    ['trendline', 'horizontal_line', 'fibonacci', 'rectangle', 'anchored_volume_profile'],
    ['long_position', 'short_position'],
    ['measure'],
];

export default function TerminalSidebar({ activeTool, onToolChange, onClearAll, onToggleObjectTree, showObjectTree, drawingCount, theme }: TerminalSidebarProps) {
    const toolMap = Object.fromEntries(TOOLS.map(t => [t.id, t]));

    return (
        <div
            className="flex flex-col items-center py-1 select-none"
            style={{
                width: 40,
                minWidth: 40,
                background: theme.toolbarBg,
                borderRight: `1px solid ${theme.toolbarBorder}`,
            }}
        >
            {TOOL_GROUPS.map((group, gi) => (
                <React.Fragment key={gi}>
                    {gi > 0 && (
                        <div
                            className="w-6 my-1"
                            style={{ height: 1, background: theme.toolbarBorder }}
                        />
                    )}
                    {group.map((toolId) => {
                        const tool = toolMap[toolId];
                        if (!tool) return null;
                        const isActive = activeTool === toolId;
                        return (
                            <button
                                key={toolId}
                                title={tool.label}
                                onPointerDown={(e) => {
                                    e.preventDefault(); // Prevent focus issues and double-tap behaviors
                                    onToolChange(toolId);
                                }}
                                className="flex items-center justify-center rounded transition-colors duration-100"
                                style={{
                                    width: 36,
                                    height: 36,
                                    color: isActive ? theme.toolbarIconActive : theme.toolbarIcon,
                                    background: isActive ? theme.toolbarActiveBg : 'transparent',
                                }}
                                onMouseEnter={(e) => {
                                    if (!isActive) {
                                        e.currentTarget.style.background = theme.toolbarActiveBg;
                                        e.currentTarget.style.color = theme.toolbarIconActive;
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive) {
                                        e.currentTarget.style.background = 'transparent';
                                        e.currentTarget.style.color = theme.toolbarIcon;
                                    }
                                }}
                            >
                                {tool.icon}
                            </button>
                        );
                    })}
                </React.Fragment>
            ))}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Object Tree toggle */}
            <div className="w-6 mb-1" style={{ height: 1, background: theme.toolbarBorder }} />
            <button
                title="Object Tree"
                onPointerDown={(e) => {
                    e.preventDefault();
                    onToggleObjectTree();
                }}
                className="flex items-center justify-center rounded transition-colors duration-100 mb-1"
                style={{
                    width: 36,
                    height: 36,
                    position: 'relative',
                    color: showObjectTree ? theme.toolbarIconActive : theme.toolbarIcon,
                    background: showObjectTree ? theme.toolbarActiveBg : 'transparent',
                }}
                onMouseEnter={(e) => {
                    if (!showObjectTree) {
                        e.currentTarget.style.background = theme.toolbarActiveBg;
                        e.currentTarget.style.color = theme.toolbarIconActive;
                    }
                }}
                onMouseLeave={(e) => {
                    if (!showObjectTree) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = theme.toolbarIcon;
                    }
                }}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="3" y="3" width="18" height="4" rx="1" />
                    <rect x="3" y="10" width="13" height="4" rx="1" />
                    <rect x="3" y="17" width="9" height="4" rx="1" />
                </svg>
                {drawingCount > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        background: theme.accent,
                        color: '#000',
                        fontSize: 7,
                        fontWeight: 800,
                        width: 11,
                        height: 11,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                    }}>
                        {drawingCount > 9 ? '9+' : drawingCount}
                    </span>
                )}
            </button>

            {/* Clear All (bottom) */}
            <button
                title="Clear All Drawings"
                onClick={onClearAll}
                className="flex items-center justify-center rounded transition-colors duration-100 mb-1"
                style={{
                    width: 36,
                    height: 36,
                    color: theme.toolbarIcon,
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ef4444';
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.color = theme.toolbarIcon;
                    e.currentTarget.style.background = 'transparent';
                }}
            >
                <TrashIcon />
            </button>
        </div>
    );
}
