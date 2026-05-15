import { NextRequest, NextResponse } from "next/server";

const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:8000";

async function proxyRequest(request: NextRequest, params: { path: string[] }, method: string, body?: string) {
    const pathStr = params.path.join('/');
    const url = `${PYTHON_API_URL}/api/paper/${pathStr}`;

    try {
        const fetchOptions: RequestInit = {
            method,
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
            },
        };
        if (body) fetchOptions.body = body;

        const res = await fetch(url, fetchOptions);
        const text = await res.text();

        // Attempt to parse as JSON; fallback to plain text error
        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch {
            // Python returned non-JSON (e.g. HTML "Internal Server Error")
            return NextResponse.json(
                { error: `Backend error (${res.status}): ${text.slice(0, 200)}` },
                { status: res.status || 502 }
            );
        }

        return NextResponse.json(data, { status: res.status });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
            { error: `Failed to reach backend: ${msg}` },
            { status: 503 }
        );
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const resolvedParams = await params;
    return proxyRequest(request, resolvedParams, 'GET');
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const resolvedParams = await params;
    const body = await request.text();
    return proxyRequest(request, resolvedParams, 'POST', body);
}
