/*
|--------------------------------------------------------------------------
| dashboard.js
|--------------------------------------------------------------------------
| Printer dashboard
|--------------------------------------------------------------------------
*/

const express = require("express");

const {
    getQueue,
    getProcessingJob,
    getPrintHistory,
    getPrinterState,
    getPrintJob,
    getUsersByIds,
    updateJobStatus,
    updatePrinterState,
    updateOrderStatus
} = require("./database");

const {
    cancelPrint,
    getPrinterStatus,
    setPrinterEnabled
} = require("./printer");

const router = express.Router();

router.post(
    "/api/jobs/:jobId/reject",
    async (req, res) => {
        try {
            const job = await getPrintJob(req.params.jobId);
            if (!job) {
                return res.status(404).send("Print job not found");
            }

            const wasActive = ["processing", "submitted"].includes(job.status);
            let cancelError;
            if (wasActive && job.cupsJobId) {
                try {
                    await cancelPrint(job.cupsJobId);
                } catch (error) {
                    cancelError = error;
                }
            }

            await updateJobStatus(job._id, "cancelled", {
                error: cancelError
                    ? `Rejected from dashboard; CUPS cancel failed: ${cancelError.message}`
                    : "Rejected from printer dashboard"
            });

            await updateOrderStatus(job.orderId, "CANCELLED");

            if (wasActive) {
                await updatePrinterState({
                    state: "ready",
                    connected: true,
                    activeJobId: undefined,
                    message: "Print rejected from dashboard",
                    lastError: undefined
                });
            }

            res.redirect("/dashboard/");
        } catch (error) {
            res.status(500).send(`Unable to reject print job: ${escapeHtml(error.message)}`);
        }
    }
);

router.post(
    "/api/printer/recheck",
    async (req, res) => {
        try {
            const status = await getPrinterStatus();
            await updatePrinterState({
                printerName: process.env.PRINTER_NAME,
                connected: status.connected,
                state: status.state,
                message: status.message,
                lastError: status.connected ? undefined : status.message
            });
            res.redirect("/dashboard/");
        } catch (error) {
            res.status(500).send(`Unable to check printer: ${escapeHtml(error.message)}`);
        }
    }
);

router.post(
    "/api/printer/:action",
    async (req, res) => {
        const enabled = req.params.action === "resume";
        if (!enabled && req.params.action !== "pause") {
            return res.status(404).send("Unknown printer action");
        }

        try {
            await setPrinterEnabled(enabled);
            const status = await getPrinterStatus();
            await updatePrinterState({
                printerName: process.env.PRINTER_NAME,
                connected: status.connected,
                state: status.state,
                message: status.message,
                lastError: status.connected ? undefined : status.message
            });
            res.redirect("/dashboard/");
        } catch (error) {
            res.status(500).send(`Unable to ${enabled ? "resume" : "pause"} printer: ${escapeHtml(error.message)}`);
        }
    }
);


/*
|--------------------------------------------------------------------------
| Dashboard HTML
|--------------------------------------------------------------------------
*/

router.get(
    "/",
    async (req, res) => {

        try {

            const processing =
                await getProcessingJob();

            const queue =
                await getQueue();

            const history =
                await getPrintHistory(50);

            const printerState =
                await getPrinterState();

            const usersById = await getUsersByIds([
                processing?.userId,
                ...queue.map(job => job.userId),
                ...history.map(job => job.userId)
            ]);

            const current = processing
                ? withUserName(processing, usersById)
                : processing;
            const displayQueue = queue.map(job => withUserName(job, usersById));
            const displayHistory = history.map(job => withUserName(job, usersById));

            const pendingCount = displayQueue.filter(
                job => job.status === "pending"
            ).length;

            const failedCount = displayHistory.filter(
                job => job.status === "failed"
            ).length;

            const completedCount = displayHistory.filter(
                job => job.status === "completed"
            ).length;


            res.send(`

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>UniKart Printer Dashboard</title>

<meta http-equiv="refresh"
      content="5">

<style>

* {
    box-sizing: border-box;
}

:root {
    --ink: #172033;
    --muted: #64748b;
    --line: #dbe3ec;
    --surface: #ffffff;
    --soft: #f4f7fb;
    --teal: #0f766e;
    --red: #b42318;
    --shadow: 0 12px 30px rgba(15, 23, 42, .07);
}

body {

    margin: 0;

    font-family: "Segoe UI", Arial, sans-serif;

    background:
        radial-gradient(circle at 10% 0%, rgba(20, 184, 166, .10), transparent 30%),
        linear-gradient(135deg, #f7fafc 0%, #eef3f7 100%);

    color: var(--ink);
}

.header {
    background: linear-gradient(135deg, #102a43 0%, #155e75 100%);

    color:
        white;

    padding: 24px 30px;

    box-shadow: 0 8px 24px rgba(16,42,67,.18);

}

.header h1 {

    margin:
        0 0 5px 0;

}

.header p {

    margin:
        0;

    opacity:
        .7;

}

.container {

    max-width:
        1400px;

    margin:
        auto;

    padding:
        25px;

}

.header-row {
    max-width: 1400px;
    margin: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
}

.live {
    border: 1px solid rgba(255,255,255,.35);
    border-radius: 999px;
    padding: 8px 12px;
    font-size: 12px;
    white-space: nowrap;
}

.live::first-letter {
    color: #5eead4;
}

.metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 14px;
    margin-bottom: 20px;
}

.metric {
    background: white;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: var(--shadow);
}

.metric strong {
    display: block;
    color: var(--ink);
    font-size: 28px;
    margin-top: 5px;
}

.state-ready { color: #15803d !important; }
.state-printing { color: #0369a1 !important; }
.state-paused, .state-unknown { color: #a16207 !important; }
.state-offline, .state-error { color: #b91c1c !important; }

.muted {
    color: var(--muted);
    font-size: 13px;
}

@media (max-width: 800px) {
    .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .header-row { align-items: flex-start; flex-direction: column; }
    .container { padding: 16px; }
    .card { padding: 16px; border-radius: 10px; }
    .table-card { padding-right: 0; padding-left: 0; }
    .table-card h2,
    .table-card .empty { margin-left: 16px; margin-right: 16px; }
    .table-scroll { overflow-x: auto; padding: 0 16px 4px; }
    table { min-width: 850px; }
}

@media (max-width: 480px) {
    .header { padding: 20px 16px; }
    .header h1 { font-size: 24px; }
    .metrics { gap: 8px; }
    .metric { padding: 13px; }
    .metric strong { font-size: 23px; }
    .printer-actions { display: grid; grid-template-columns: 1fr; }
    .printer-actions form,
    .printer-actions .action { width: 100%; }
}

.card {

    background: rgba(255, 255, 255, .94);

    border: 1px solid var(--line);
    border-radius: 14px;

    padding:
        20px;

    margin-bottom:
        20px;

    box-shadow: var(--shadow);

}

.card h2 {

    margin-top:
        0;

    color: var(--ink);
    font-size: 18px;
    letter-spacing: .01em;

}

.current {

    border-left:
        6px solid
        #16a34a;

}

.current h2 {
    display: flex;
    align-items: center;
    gap: 8px;
}

.grid {

    display:
        grid;

    grid-template-columns:
        repeat(
            auto-fit,
            minmax(220px, 1fr)
        );

    gap:
        12px;

}

.info {

    background: var(--soft);
    border: 1px solid #e7edf4;

    padding:
        12px;

    border-radius:
        8px;

}

.label {

    font-size:
        12px;

    color:
        #64748b;

}

.value {

    margin-top:
        4px;

    font-weight:
        600;

    word-break:
        break-word;

}

table {

    width:
        100%;

    border-collapse:
        collapse;

}

th,
td {

    padding:
        12px;

    border-bottom:
        1px solid
        #e5e7eb;

    text-align:
        left;

    vertical-align: top;

}

th {

    background: #edf3f8;
    color: #475569;
    font-size: 12px;
    letter-spacing: .04em;
    text-transform: uppercase;
}


tr:hover td {
    background: #fbfdff;
}

.badge {

    display:
        inline-block;

    padding:
        5px 9px;

    border-radius:
        20px;

    font-size:
        12px;

    font-weight:
        bold;

}

.normal {

    background:
        #dbeafe;

}

.express {

    background:
        #fee2e2;

}

.processing {

    background:
        #dcfce7;

}

.failed {
    background: #fee2e2;
    color: #991b1b;
}

.cancelled {
    background: #e2e8f0;
    color: #475569;
}

.submitted {
    background: #dbeafe;
    color: #1d4ed8;
}

.pending {

    background:
        #fef3c7;

}

.empty {

    text-align:
        center;

    padding:
        30px;

    color:
        #64748b;

}

.details {

    margin-top:
        15px;

    border-top: 1px solid var(--line);
    padding-top: 15px;


.details h3 {
    margin: 0 0 12px;
    font-size: 15px;
    color: #334155;
}
}

    min-width: 180px;
        pointer;

}

summary {
    cursor: pointer;
    font-weight:
        bold;

    color: var(--teal);

}

.action {
    border: 0;
    border-radius: 6px;
    padding: 8px 12px;
    background: var(--teal);
    color: white;
    cursor: pointer;
    font-weight: 600;
    transition: transform .15s ease, filter .15s ease;
    white-space: nowrap;
}

.action:hover {
    filter: brightness(.94);
    transform: translateY(-1px);
}

.action.danger {
    background: #b91c1c;
}

form {
    margin: 0 0 14px;
}

td form {
    margin: 0;
}

.printer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
}

.printer-actions form {
    margin: 0;
}

</style>

</head>


<body>


<div class="header">

<div class="header-row">

<div>

    <h1>
        UniKart Printer Dashboard
    </h1>
    <p>
        Automatic PDF print queue and CUPS monitor
    </p>

</div>

<div class="live">● Live · refreshes every 5 seconds</div>

</div>

</div>


<div class="container">

<div class="metrics">

<div class="metric">
<div class="label">Printer state</div>
<strong class="state-${escapeHtml(printerState?.state || "unknown")}">${escapeHtml(printerState?.state || "unknown")}</strong>
<div class="muted">${escapeHtml(printerState?.message || "No status check yet")}</div>
</div>

<div class="metric">
<div class="label">Active job</div>
<strong>${current ? "1" : "0"}</strong>
<div class="muted">CUPS submission</div>
</div>

<div class="metric">
<div class="label">Waiting</div>
<strong>${pendingCount}</strong>
<div class="muted">Pending print jobs</div>
</div>

<div class="metric">
<div class="label">Completed</div>
<strong>${completedCount}</strong>
<div class="muted">Recent history</div>
</div>

<div class="metric">
<div class="label">Failed</div>
<strong>${failedCount}</strong>
<div class="muted">Recent history</div>
</div>

</div>

<div class="card">
<h2>Printer and Recovery</h2>
<div class="printer-actions">
<form method="post" action="/dashboard/api/printer/recheck">
<button class="action" type="submit">Check printer now</button>
</form>
<form method="post" action="/dashboard/api/printer/pause">
<button class="action danger" type="submit">Pause printer</button>
</form>
<form method="post" action="/dashboard/api/printer/resume">
<button class="action" type="submit">Resume printer</button>
</form>
</div>
<div class="grid">
<div class="info"><div class="label">Printer</div><div class="value">${escapeHtml(printerState?.printerName || process.env.PRINTER_NAME || "-")}</div></div>
<div class="info"><div class="label">Connection</div><div class="value">${printerState?.connected ? "Connected" : "Not connected"}</div></div>
<div class="info"><div class="label">Active Job ID</div><div class="value">${escapeHtml(printerState?.activeJobId || "-")}</div></div>
<div class="info"><div class="label">Last Error</div><div class="value">${escapeHtml(printerState?.lastError || "-")}</div></div>
<div class="info"><div class="label">Last Checked</div><div class="value">${formatDate(printerState?.checkedAt)}</div></div>
<div class="info"><div class="label">Last Command</div><div class="value command-value">${escapeHtml(printerState?.lastCommand || "-")}</div></div>
</div>

${current ? `
<form method="post" action="/dashboard/api/jobs/${encodeURIComponent(current._id)}/reject">
<button class="action danger" type="submit">Reject and cancel current print</button>
</form>
` : ""}
</div>


<!-- CURRENT PRINT -->


<div class="card current">

<h2>
    🖨 Currently Printing
</h2>

${current ? `

<div class="grid">


<div class="info">

<div class="label">
Job ID
</div>

<div class="value">
${escapeHtml(current._id)}
</div>

</div>

<div class="info">
<div class="label">Folder / Priority</div>
<div class="value">${escapeHtml(current.folder || "-")} / ${current.priority || 0}</div>
</div>

<div class="info">
<div class="label">Local PDF</div>
<div class="value">${escapeHtml(current.localFile || "-")}</div>
</div>

<div class="info">
<div class="label">File Size</div>
<div class="value">${formatBytes(current.size)}</div>
</div>

<div class="info">
<div class="label">Started</div>
<div class="value">${formatDate(current.updatedAt)}</div>
</div>

<div class="info">
<div class="label">
User
</div>
<div class="value">
${escapeHtml(current.userName)}
</div>

</div>


<div class="info">

<div class="label">
Order ID
</div>

<div class="value">
${escapeHtml(current.orderId || "-")}
</div>

</div>


<div class="info">

<div class="label">
Original File
</div>

<div class="value">
${escapeHtml(current.originalName || "-")}
</div>

</div>


<div class="info">

<div class="label">
CUPS Job
</div>

<div class="value">
${escapeHtml(current.cupsJobId || "-")}
</div>

</div>


<div class="info">

<div class="label">
Status
</div>

<div class="value">

<span class="badge processing">
${escapeHtml(current.status)}
</span>

</div>

</div>

</div>


<div class="details">

${printOptions(current.options)}

</div>

` : `

<div class="empty">
No job is currently printing.
</div>

`}

</div>



<!-- QUEUE -->


<div class="card table-card">

<h2>
    📋 Current Queue
</h2>

${displayQueue.length > 0 ? `

<div class="table-scroll">
<table>

<thead>

<tr>

<th>#</th>

<th>Type</th>

<th>File</th>

<th>User</th>

<th>Order</th>

<th>Status</th>

<th>Pages</th>

<th>Copies</th>

<th>Created</th>

<th>Action</th>

</tr>

</thead>


<tbody>

${displayQueue.map((job, index) => `

<tr>

<td>
${index + 1}
</td>


<td>

<span class="badge ${job.folder === "express" ? "express" : "normal"}">

${job.folder}

</span>

</td>


<td>
${escapeHtml(job.originalName || "-")}
</td>


<td>
${escapeHtml(job.userName)}
</td>


<td>
${escapeHtml(job.orderId || "-")}
</td>


<td>

<span class="badge ${escapeHtml(job.status)}">

${escapeHtml(job.status)}

</span>

</td>


<td>
${job.options?.pages || "-"}
</td>


<td>
${job.options?.copies || 1}
</td>


<td>
${formatDate(job.createdAt)}
</td>

<td>
${job.status === "pending" || job.status === "processing" || job.status === "submitted" ? `
<form method="post" action="/dashboard/api/jobs/${encodeURIComponent(job._id)}/reject">
<button class="action danger" type="submit">Reject</button>
</form>` : "-"}
</td>

</tr>

`).join("")}

</tbody>

</table>
</div>

` : `

<div class="empty">
Queue is empty.
</div>

`}

</div>



<!-- HISTORY -->


<div class="card table-card">

<h2>
    📜 Print History
</h2>

${displayHistory.length > 0 ? `

<div class="table-scroll">
<table>

<thead>

<tr>

<th>File</th>

<th>Type</th>

<th>User</th>

<th>Status</th>

<th>CUPS Job</th>

<th>Updated</th>

<th>Details / Action</th>

</tr>

</thead>


<tbody>

${displayHistory.map(job => `

<tr>

<td>
${escapeHtml(job.originalName || "-")}
</td>

<td>
${escapeHtml(job.folder || "-")}
</td>

<td>
${escapeHtml(job.userName)}
</td>

<td>
${escapeHtml(job.status)}
</td>

<td>
${escapeHtml(job.cupsJobId || "-")}
</td>

<td>
${formatDate(job.updatedAt)}
</td>

<td>
<details>
<summary>View complete details</summary>
${jobDetails(job)}
</details>
${job.status === "failed" ? `
<form method="post" action="/dashboard/api/jobs/${encodeURIComponent(job._id)}/reject">
<button class="action danger" type="submit">Reject and mark cancelled</button>
</form>` : ""}
</td>

</tr>

`).join("")}

</tbody>

</table>
</div>

` : `

<div class="empty">
No printing history.
</div>

`}

</div>


</div>


</body>

</html>

            `);

        } catch (error) {

            console.error(
                "Dashboard error:",
                error
            );

            res.status(500).send(
                "Dashboard error"
            );
        }
    }
);


/*
|--------------------------------------------------------------------------
| JSON API - Queue
|--------------------------------------------------------------------------
*/

router.get(
    "/api/queue",
    async (req, res) => {

        try {

            const queue =
                await getQueue();

            res.json({
                success: true,
                count: queue.length,
                data: queue
            });

        } catch (error) {

            res.status(500).json({

                success: false,

                message:
                    error.message

            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| JSON API - Current
|--------------------------------------------------------------------------
*/

router.get(
    "/api/current",
    async (req, res) => {

        try {

            const job =
                await getProcessingJob();

            res.json({

                success: true,

                data:
                    job

            });

        } catch (error) {

            res.status(500).json({

                success: false,

                message:
                    error.message

            });
        }
    }
);

router.get(
    "/api/printer",
    async (req, res) => {
        try {
            const state = await getPrinterState();

            res.json({
                success: true,
                data: state
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";
    }

    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


function formatDate(date) {

    if (!date) {
        return "-";
    }

    return new Date(date)
        .toLocaleString();
}

function formatBytes(bytes) {
    if (!bytes) {
        return "-";
    }

    const units = ["B", "KB", "MB", "GB"];
    let value = Number(bytes);
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }

    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function withUserName(job, usersById) {
    const plainJob = typeof job.toObject === "function"
        ? job.toObject()
        : job;
    const user = usersById.get(String(plainJob.userId || ""));
    const name = user && (
        user.name ||
        user.fullName ||
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.username ||
        user.email
    );

    return {
        ...plainJob,
        userName: name || "Unknown user"
    };
}

function jobDetails(job) {
    return `
<div class="details">
<div class="grid">
<div class="info"><div class="label">Job ID</div><div class="value">${escapeHtml(job._id)}</div></div>
<div class="info"><div class="label">User</div><div class="value">${escapeHtml(job.userName)}</div></div>
<div class="info"><div class="label">Order ID</div><div class="value">${escapeHtml(job.orderId || "-")}</div></div>
<div class="info"><div class="label">Original file</div><div class="value">${escapeHtml(job.originalName || "-")}</div></div>
<div class="info"><div class="label">Local file</div><div class="value">${escapeHtml(job.localFile || "-")}</div></div>
<div class="info"><div class="label">Folder / priority</div><div class="value">${escapeHtml(job.folder || "-")} / ${job.priority || 0}</div></div>
<div class="info"><div class="label">File size</div><div class="value">${formatBytes(job.size)}</div></div>
<div class="info"><div class="label">CUPS job</div><div class="value">${escapeHtml(job.cupsJobId || "-")}</div></div>
<div class="info"><div class="label">Created</div><div class="value">${formatDate(job.createdAt)}</div></div>
<div class="info"><div class="label">Updated</div><div class="value">${formatDate(job.updatedAt)}</div></div>
<div class="info"><div class="label">Error</div><div class="value">${escapeHtml(job.error || "-")}</div></div>
</div>
${printOptions(job.options || {})}
</div>`;
}


function printOptions(options = {}) {

    return `

<h3>
Print Configuration
</h3>

<div class="grid">


<div class="info">
<div class="label">Copies</div>
<div class="value">
${options.copies || 1}
</div>
</div>


<div class="info">
<div class="label">Paper Size</div>
<div class="value">
${escapeHtml(options.paperSize || options.pageSize || "A4")} <span class="muted">(media size)</span>
</div>
</div>

<div class="info">
<div class="label">Input Slot</div>
<div class="value">
${escapeHtml(options.inputSlot || options.mediaSource || "Auto")} <span class="muted">(paper source)</span>
</div>
</div>

<div class="info">
<div class="label">Media Type</div>
<div class="value">
${escapeHtml(options.mediaType || "Stationery")} <span class="muted">(paper surface)</span>
</div>
</div>


<div class="info">
<div class="label">Color</div>
<div class="value">
${escapeHtml(options.colorModel || options.color || "RGB")} <span class="muted">(output mode)</span>
</div>
</div>


<div class="info">
<div class="label">Printing Type</div>
<div class="value">
${escapeHtml(options.printingType || "Standard")} <span class="muted">(job mode)</span>
</div>
</div>


<div class="info">
<div class="label">Duplex</div>
<div class="value">
${escapeHtml(options.duplexMode || (options.duplex ? "DuplexNoTumble" : "None"))} <span class="muted">(page sides)</span>
</div>
</div>


<div class="info">
<div class="label">Quality</div>
<div class="value">
${escapeHtml(options.cupsPrintQuality || options.quality || "Normal")} <span class="muted">(ink quality)</span>
</div>

<div class="info">
<div class="label">Output Bin</div>
<div class="value">
${escapeHtml(options.outputBin || "FaceUp")} <span class="muted">(paper output)</span>
</div>
</div>
</div>


<div class="info">
<div class="label">Scaling</div>
<div class="value">
${escapeHtml(options.scaling || "-")}
</div>
</div>


<div class="info">
<div class="label">Orientation</div>
<div class="value">
${escapeHtml(options.orientation || "-")}
</div>
</div>


<div class="info">
<div class="label">Paper Weight</div>
<div class="value">
${options.paperWeight || "-"} GSM
</div>
</div>


<div class="info">
<div class="label">Pages</div>
<div class="value">
${options.pages || "All"} <span class="muted">(page count)</span>
</div>
</div>


<div class="info">
<div class="label">Page Selection</div>
<div class="value">
${escapeHtml(options.pageSelection || "All Pages")} <span class="muted">(range)</span>
</div>
</div>


<div class="info">
<div class="label">Binding</div>
<div class="value">
${escapeHtml(options.binding || "None")}
</div>
</div>


<div class="info">
<div class="label">Folders</div>
<div class="value">
${options.folders || 0}
</div>
</div>


<div class="info">
<div class="label">Stick Files</div>
<div class="value">
${options.stickFiles || 0}
</div>
</div>


<div class="info">
<div class="label">Emergency</div>
<div class="value">
${options.isEmergency ? "YES" : "NO"}
</div>
</div>


<div class="info">
<div class="label">Pickup Slot</div>
<div class="value">
${escapeHtml(options.pickupSlot || "-")}
</div>
</div>


</div>

`;

}


module.exports = router;