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
    getPrintHistory
} = require("./database");

const router = express.Router();


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


            const current =
                processing;


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

body {

    margin: 0;

    font-family:
        Arial,
        Helvetica,
        sans-serif;

    background:
        #f4f6f8;

    color:
        #222;
}

.header {

    background:
        #111827;

    color:
        white;

    padding:
        20px 30px;

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

.card {

    background:
        white;

    border-radius:
        12px;

    padding:
        20px;

    margin-bottom:
        20px;

    box-shadow:
        0 2px 10px
        rgba(0,0,0,.08);

}

.card h2 {

    margin-top:
        0;

}

.current {

    border-left:
        6px solid
        #16a34a;

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

    background:
        #f8fafc;

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

}

th {

    background:
        #f8fafc;

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

}

details {

    cursor:
        pointer;

}

summary {

    font-weight:
        bold;

}

</style>

</head>


<body>


<div class="header">

    <h1>
        UniKart Printer Dashboard
    </h1>

    <p>
        Automatic PDF Print Queue
    </p>

</div>


<div class="container">


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

<div class="label">
User ID
</div>

<div class="value">
${escapeHtml(current.userId)}
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


<div class="card">

<h2>
    📋 Current Queue
</h2>

${queue.length > 0 ? `

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

</tr>

</thead>


<tbody>

${queue.map((job, index) => `

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
${escapeHtml(job.userId || "-")}
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

</tr>

`).join("")}

</tbody>

</table>

` : `

<div class="empty">
Queue is empty.
</div>

`}

</div>



<!-- HISTORY -->


<div class="card">

<h2>
    📜 Print History
</h2>

${history.length > 0 ? `

<table>

<thead>

<tr>

<th>File</th>

<th>Type</th>

<th>User</th>

<th>Status</th>

<th>CUPS Job</th>

<th>Updated</th>

</tr>

</thead>


<tbody>

${history.map(job => `

<tr>

<td>
${escapeHtml(job.originalName || "-")}
</td>

<td>
${escapeHtml(job.folder || "-")}
</td>

<td>
${escapeHtml(job.userId || "-")}
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

</tr>

`).join("")}

</tbody>

</table>

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
${escapeHtml(options.paperSize || "A4")}
</div>
</div>


<div class="info">
<div class="label">Color</div>
<div class="value">
${escapeHtml(options.color || "-")}
</div>
</div>


<div class="info">
<div class="label">Printing Type</div>
<div class="value">
${escapeHtml(options.printingType || "-")}
</div>
</div>


<div class="info">
<div class="label">Duplex</div>
<div class="value">
${options.duplex ? "Yes" : "No"}
</div>
</div>


<div class="info">
<div class="label">Quality</div>
<div class="value">
${escapeHtml(options.quality || "-")}
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
${options.pages || "-"}
</div>
</div>


<div class="info">
<div class="label">Page Selection</div>
<div class="value">
${escapeHtml(options.pageSelection || "All Pages")}
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