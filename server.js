/*
|--------------------------------------------------------------------------
| server.js
|--------------------------------------------------------------------------
| UniKart Printer Client
|--------------------------------------------------------------------------
*/

require("dotenv").config();

const axios = require("axios");

const fs = require("fs");

const path = require("path");

const express = require("express");

const {
    execFile
} = require("child_process");

const {
    promisify
} = require("util");

const PDFDocument = require("pdfkit");

const {
    getQueueStatus,
    getPrinterStatus,
    cancelPrint,
    submitPrint,
    normalizeOptions
} = require("./printer");


const {
    connectDatabase,
    getPendingJobs,
    getProcessingJob,
    getRecoverableJob,
    getPrintJob,
    updateOrderStatus,
    updatePrinterState,
    updateJobStatus,
    setCupsJobId
} = require("./database");


const dashboard =
    require("./dashboard");


const execFileAsync =
    promisify(execFile);


/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const PORT =
    Number(process.env.PORT) || 3000;


const SERVER_URL =
    process.env.SERVER_URL;


const FILE_API_KEY =
    process.env.FILE_API_KEY;


const POLL_INTERVAL =
    Number(
        process.env.POLL_INTERVAL
    ) || 5000;


const DOWNLOAD_DIR =
    path.resolve(
        process.env.DOWNLOAD_DIR ||
        "./downloads"
    );


const FOLDERS = [
    "normal",
    "express",
    "cash"
];


/*
|--------------------------------------------------------------------------
| Express
|--------------------------------------------------------------------------
*/

const app =
    express();


app.use(
    express.json()
);


/*
|--------------------------------------------------------------------------
| Dashboard
|--------------------------------------------------------------------------
*/

app.use(
    "/dashboard",
    dashboard
);


/*
|--------------------------------------------------------------------------
| Validate configuration
|--------------------------------------------------------------------------
*/

if (!SERVER_URL) {

    console.error(
        "SERVER_URL missing"
    );

    process.exit(1);
}


if (!FILE_API_KEY) {

    console.error(
        "FILE_API_KEY missing"
    );

    process.exit(1);
}


/*
|--------------------------------------------------------------------------
| Axios
|--------------------------------------------------------------------------
*/

const api =
    axios.create({

        baseURL:
            SERVER_URL,

        timeout:
            10000,

        headers: {

            "X-API-Key":
                FILE_API_KEY
        }

    });


/*
|--------------------------------------------------------------------------
| Create directories
|--------------------------------------------------------------------------
*/

for (
    const folder of FOLDERS
) {

    fs.mkdirSync(

        path.join(
            DOWNLOAD_DIR,
            folder
        ),

        {
            recursive: true
        }

    );
}


/*
|--------------------------------------------------------------------------
| Convert directories
|--------------------------------------------------------------------------
*/

const TEMP_DIR =
    path.resolve("./temp");


fs.mkdirSync(
    TEMP_DIR,
    {
        recursive: true
    }
);


/*
|--------------------------------------------------------------------------
| Download server file
|--------------------------------------------------------------------------
*/

async function downloadFile(file, acknowledge = false, printOptions = {}) {

    const folder =
        file.folder;

    const originalFilename =
        path.basename(file.name);

    const extension =
        path.extname(originalFilename).toLowerCase();

    const safeBaseName =
        path.basename(
            originalFilename,
            extension
        ).replace(
            /[^a-zA-Z0-9_-]/g,
            "-"
        );

    /*
    |--------------------------------------------------------------------------
    | Temporary downloaded file
    |--------------------------------------------------------------------------
    */

    const tempPath =
        path.join(
            TEMP_DIR,
            `${safeBaseName}${extension}`
        );

    try {

        console.log("");
        console.log(
            "================================"
        );

        console.log(
            "DOWNLOADING FILE"
        );

        console.log(
            "Folder:",
            folder
        );

        console.log(
            "File:",
            originalFilename
        );

        console.log(
            "================================"
        );


        /*
        |--------------------------------------------------------------------------
        | Download from UniKart server
        |--------------------------------------------------------------------------
        */

        const response =
            await api.get(

                file.downloadUrl ||
                `/api/files/download/` +
                `${encodeURIComponent(folder)}/` +
                `${encodeURIComponent(originalFilename)}`,

                {
                    responseType:
                        "stream",

                    timeout:
                        120000
                }
            );


        /*
        |--------------------------------------------------------------------------
        | Write temporary file
        |--------------------------------------------------------------------------
        */

        const writer =
            fs.createWriteStream(
                tempPath
            );


        await new Promise(
            (resolve, reject) => {

                response.data.pipe(
                    writer
                );

                writer.on(
                    "finish",
                    resolve
                );

                writer.on(
                    "error",
                    reject
                );

                response.data.on(
                    "error",
                    reject
                );

            }
        );


        /*
        |--------------------------------------------------------------------------
        | Verify temporary file exists
        |--------------------------------------------------------------------------
        */

        if (
            !fs.existsSync(tempPath)
        ) {

            throw new Error(
                `Downloaded file does not exist: ${tempPath}`
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Convert to PDF if required
        |--------------------------------------------------------------------------
        */

        const pdfPath =
            await ensurePdf(
                tempPath,
                originalFilename,
                folder
            );

        const normalizedOptions =
            normalizeOptions(printOptions);

        const processedPdfPath =
            normalizedOptions.color === "Gray"
                ? await convertPdfToBlackAndWhite(pdfPath)
                : pdfPath;


        /*
        |--------------------------------------------------------------------------
        | Verify PDF exists
        |--------------------------------------------------------------------------
        */

        if (
            !fs.existsSync(pdfPath)
        ) {

            throw new Error(
                `PDF conversion failed. File not found: ${pdfPath}`
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Destination folder
        |--------------------------------------------------------------------------
        */

        const finalFolder =
            path.join(
                DOWNLOAD_DIR,
                folder
            );


        fs.mkdirSync(
            finalFolder,
            {
                recursive: true
            }
        );


        /*
        |--------------------------------------------------------------------------
        | Always save final file as .pdf
        |--------------------------------------------------------------------------
        */

        let finalFilename =
            path.basename(processedPdfPath);


        /*
        |--------------------------------------------------------------------------
        | Make sure extension is .pdf
        |--------------------------------------------------------------------------
        */

        if (
            !finalFilename
                .toLowerCase()
                .endsWith(".pdf")
        ) {

            finalFilename =
                `${safeBaseName}.pdf`;
        }


        const finalPath =
            path.join(
                finalFolder,
                finalFilename
            );


        /*
        |--------------------------------------------------------------------------
        | Move/copy PDF to final location
        |--------------------------------------------------------------------------
        */

        fs.copyFileSync(
            processedPdfPath,
            finalPath
        );


        /*
        |--------------------------------------------------------------------------
        | Now it is safe to remove temporary files
        |--------------------------------------------------------------------------
        */

        if (fs.existsSync(tempPath)) {

            fs.unlinkSync(
                tempPath
            );
        }


        /*
        |--------------------------------------------------------------------------
        | If PDF was created separately in temp,
        | delete it after copying
        |--------------------------------------------------------------------------
        */

        if (pdfPath !== tempPath && fs.existsSync(pdfPath)) {

            fs.unlinkSync(
                pdfPath
            );
        }

        if (processedPdfPath !== pdfPath && fs.existsSync(processedPdfPath)) {

            fs.unlinkSync(
                processedPdfPath
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Verify final file
        |--------------------------------------------------------------------------
        */

        if (
            !fs.existsSync(finalPath)
        ) {

            throw new Error(
                `Final PDF was not created: ${finalPath}`
            );
        }


        const stats =
            fs.statSync(
                finalPath
            );


        console.log("");
        console.log(
            "PDF SAVED SUCCESSFULLY"
        );

        console.log(
            "Original:",
            originalFilename
        );

        console.log(
            "PDF:",
            finalFilename
        );

        console.log(
            "Folder:",
            folder
        );

        console.log(
            "Path:",
            finalPath
        );

        console.log(
            "Size:",
            stats.size,
            "bytes"
        );


        /*
        |--------------------------------------------------------------------------
        | ACK only AFTER local PDF is safely saved
        |--------------------------------------------------------------------------
        */

        if (acknowledge) {
            await acknowledgeFile(
                folder,
                originalFilename
            );

            console.log(
                "Server file acknowledged."
            );
        }


        return {

            localPath:
                finalPath,

            size:
                stats.size,

            originalName:
                originalFilename,

            pdfName:
                finalFilename

        };


    } catch (error) {

        console.error(
            "\nFile processing failed:"
        );

        console.error(
            error.message
        );


        /*
        |--------------------------------------------------------------------------
        | Cleanup temporary files
        |--------------------------------------------------------------------------
        */

        if (
            fs.existsSync(tempPath)
        ) {

            try {

                fs.unlinkSync(
                    tempPath
                );

            } catch (cleanupError) {

                console.error(
                    "Temp cleanup failed:",
                    cleanupError.message
                );
            }
        }


        /*
        |--------------------------------------------------------------------------
        | IMPORTANT:
        | Do not ACK the server file if anything failed.
        |--------------------------------------------------------------------------
        */

        console.log(
            "Server file was NOT acknowledged."
        );

        console.log(
            "It will be retried."
        );


        throw error;
    }
}


/*
|--------------------------------------------------------------------------
| Ensure PDF
|--------------------------------------------------------------------------
*/

async function ensurePdf(
    inputPath,
    originalName,
    folder
) {

    const extension =
        path.extname(
            originalName
        ).toLowerCase();


    /*
    |--------------------------------------------------------------------------
    | Already PDF
    |--------------------------------------------------------------------------
    */

    if (
        extension === ".pdf"
    ) {

        return inputPath;
    }


    /*
    |--------------------------------------------------------------------------
    | Images
    |--------------------------------------------------------------------------
    */

    const imageExtensions = [
        ".jpg",
        ".jpeg",
        ".png",
        ".bmp",
        ".webp"
    ];


    if (
        imageExtensions.includes(
            extension
        )
    ) {

        return await imageToPdf(
            inputPath,
            originalName
        );
    }


    /*
    |--------------------------------------------------------------------------
    | Office / other supported formats
    |--------------------------------------------------------------------------
    */

    return await libreOfficeToPdf(
        inputPath
    );
}

/*
|--------------------------------------------------------------------------
| Convert PDF to black and white
|--------------------------------------------------------------------------
*/

async function convertPdfToBlackAndWhite(
    inputPath
) {

    const executable =
        process.platform === "win32"
            ? "gswin64c"
            : "gs";

    const outputPath =
        path.join(
            TEMP_DIR,
            `bw-${Date.now()}-${path.basename(inputPath)}`
        );

    try {

        await execFileAsync(
            executable,
            [
                "-dSAFER",
                "-dBATCH",
                "-dNOPAUSE",
                "-sDEVICE=pdfwrite",
                "-sColorConversionStrategy=Gray",
                "-dProcessColorModel=/DeviceGray",
                `-sOutputFile=${outputPath}`,
                inputPath
            ],
            {
                timeout: 120000
            }
        );

        if (!fs.existsSync(outputPath)) {
            throw new Error("Ghostscript failed to create a black-and-white PDF");
        }

        return outputPath;
    } catch (error) {

        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }

        if (error.code === "ENOENT") {
            throw new Error(
                `Black-and-white PDF conversion requires Ghostscript (${executable} must be installed and available in PATH)`
            );
        }

        throw error;
    }
}

/*
|--------------------------------------------------------------------------
| Image → PDF
|--------------------------------------------------------------------------
*/

async function imageToPdf(
    imagePath,
    originalName
) {

    const baseName =
        path.basename(
            originalName,
            path.extname(
                originalName
            )
        );


    const outputPath =
        path.join(

            TEMP_DIR,

            `${Date.now()}-${baseName}.pdf`

        );


    return await new Promise(
        (resolve, reject) => {

            const doc =
                new PDFDocument({
                    autoFirstPage:
                        false
                });


            const stream =
                fs.createWriteStream(
                    outputPath
                );


            doc.pipe(stream);


            /*
            |--------------------------------------------------------------
            | Add image to PDF
            |--------------------------------------------------------------
            */

            doc.addPage();


            doc.image(
                imagePath,
                0,
                0,
                {
                    fit: [
                        595,
                        842
                    ],

                    align:
                        "center",

                    valign:
                        "center"
                }
            );


            doc.end();


            stream.on(
                "finish",
                () => {

                    resolve(
                        outputPath
                    );
                }
            );


            stream.on(
                "error",
                reject
            );

        }
    );
}


/*
|--------------------------------------------------------------------------
| LibreOffice conversion
|--------------------------------------------------------------------------
*/

async function libreOfficeToPdf(
    inputPath
) {

    const outputDirectory =
        TEMP_DIR;


    await execFileAsync(

        "libreoffice",

        [

            "--headless",

            "--convert-to",
            "pdf",

            "--outdir",
            outputDirectory,

            inputPath

        ],

        {
            timeout:
                120000
        }

    );


    const inputBaseName =
        path.basename(
            inputPath,
            path.extname(
                inputPath
            )
        );


    const outputPath =
        path.join(

            outputDirectory,

            `${inputBaseName}.pdf`

        );


    if (
        !fs.existsSync(
            outputPath
        )
    ) {

        throw new Error(
            "LibreOffice failed to create PDF"
        );
    }


    return outputPath;
}


/*
|--------------------------------------------------------------------------
| ACK server
|--------------------------------------------------------------------------
*/

async function acknowledgeFile(
    folder,
    filename
) {

    const response =
        await api.post(
            "/api/files/ack",

            {
                folder,
                filename
            }
        );


    console.log(
        "Server ACK:",
        response.data.message
    );
}

async function acknowledgeOriginalFile(folder, originalName) {
    const response = await api.post(
        "/api/files/ack-by-original",
        {
            folder,
            originalName
        }
    );

    console.log(
        "Server file acknowledged:",
        response.data.message
    );
}

async function acknowledgePrintedFile(job) {
    if (!job.folder || !job.originalName) {
        return;
    }

    try {
        await acknowledgeOriginalFile(
            job.folder,
            job.originalName
        );
    } catch (error) {
        console.error(
            "Could not acknowledge printed file:",
            error.message
        );
    }
}


/*
|--------------------------------------------------------------------------
| Fetch next file
|--------------------------------------------------------------------------
*/

async function checkForNewFile() {

    try {
        return true;


    } catch (error) {

        console.error(
            "File processing error:",
            error.message
        );

        return false;
    }
}


/*
|--------------------------------------------------------------------------
| Queue processor
|--------------------------------------------------------------------------
*/

let queueProcessing =
    false;


async function processQueue() {

    if (
        queueProcessing
    ) {

        return;
    }


    /*
    |--------------------------------------------------------------------------
    | Check whether something is already printing
    |--------------------------------------------------------------------------
    */

    const current =
        await getProcessingJob();


    if (current) {

        return;
    }


    queueProcessing = true;


    try {
        const printerState = await getPrinterStatus();

        await updatePrinterState({
            printerName: process.env.PRINTER_NAME,
            connected: printerState.connected,
            state: printerState.state,
            message: printerState.message,
            lastError: printerState.connected ? undefined : printerState.message
        });

        if (!printerState.connected || printerState.state !== "ready") {
            console.error(
                "Printer is not ready:",
                printerState.message
            );

            return;
        }

        const jobs =
            await getPendingJobs();


        if (
            jobs.length === 0
        ) {

            return;
        }

        jobs.sort((first, second) => {
            const firstFolder = resolveJobFolder(first);
            const secondFolder = resolveJobFolder(second);

            const firstPriority =
                firstFolder === "express" ? 100 : first.priority || 0;

            const secondPriority =
                secondFolder === "express" ? 100 : second.priority || 0;

            if (firstPriority !== secondPriority) {
                return secondPriority - firstPriority;
            }

            return first.createdAt - second.createdAt;
        });


        /*
        |--------------------------------------------------------------------------
        | First job according to priority/FIFO
        |--------------------------------------------------------------------------
        */

        const job =
            jobs[0];

        const folder =
            resolveJobFolder(job);

        if (job.folder !== folder) {
            await updateJobStatus(
                job._id,
                "pending",
                {
                    folder
                }
            );

            job.folder = folder;
        }


        console.log("");
        console.log(
            "================================"
        );

        console.log(
            "STARTING PRINT JOB"
        );

        console.log(
            "Job:",
            job._id
        );

        console.log(
            "File:",
            job.originalName
        );

        console.log(
            "Folder:",
            folder
        );

        console.log(
            "================================"
        );

        if (!job.localFile || !fs.existsSync(job.localFile)) {
            try {
                const downloaded = await downloadFile({
                    folder,
                    name: job.originalName,
                    downloadUrl:
                        `/api/files/download-by-original/` +
                        `${encodeURIComponent(folder)}/` +
                        `${encodeURIComponent(job.originalName)}`
                }, false, job.options || {});

                await updateJobStatus(
                    job._id,
                    "pending",
                    {
                        localFile: downloaded.localPath,
                        size: downloaded.size
                    }
                );

                await markOrderStatus(job, "PROCESSING");

                job.localFile = downloaded.localPath;
            } catch (error) {
                await updateJobStatus(
                    job._id,
                    "failed",
                    {
                        error: `File download failed: ${error.message}`
                    }
                );

                console.error(
                    "File download failed:",
                    error.message
                );

                return;
            }
        }


        /*
        |--------------------------------------------------------------------------
        | Mark processing
        |--------------------------------------------------------------------------
        */

        await updateJobStatus(
            job._id,
            "processing"
        );

        await markOrderStatus(job, "PROCESSING");

        await updatePrinterState({
            state: "printing",
            activeJobId: job._id,
            lastError: undefined
        });


        /*
        |--------------------------------------------------------------------------
        | Print
        |--------------------------------------------------------------------------
        */

        await printJob(
            job
        );


    } catch (error) {

        await updatePrinterState({
            state: "error",
            connected: false,
            message: error.message,
            lastError: error.message
        }).catch(() => {});

        console.error(
            "Queue error:",
            error.message
        );

    } finally {

        queueProcessing =
            false;
    }
}

async function recoverPrinterJob() {
    const job = await getRecoverableJob();

    if (!job) {
        return;
    }

    console.log(
        "Recovering print job:",
        job._id,
        job.status
    );

    if (job.status === "submitted" && job.cupsJobId) {
        await updatePrinterState({
            state: "printing",
            connected: true,
            activeJobId: job._id,
            message: "Monitoring recovered CUPS job"
        });

        await monitorCupsJob(
            job._id,
            job.cupsJobId,
            job
        );

        return;
    }

    await updateJobStatus(
        job._id,
        "pending",
        {
            cupsJobId: undefined,
            error: "Recovered after printer service restart"
        }
    );
}


/*
|--------------------------------------------------------------------------
| Submit print job through the dedicated printer module
|--------------------------------------------------------------------------
*/

async function printJob(job) {
    try {
        const result = await submitPrint(
            job.localFile,
            job.options || {}
        );

        console.log("CUPS command:", result.command);
        console.log("CUPS:", result.stdout);

        await updatePrinterState({
            state: "printing",
            connected: true,
            activeJobId: job._id,
            lastCommand: result.command,
            message: result.stdout.trim(),
            lastError: undefined
        });

        if (result.cupsJobId) {
            const submittedJob = await setCupsJobId(
                job._id,
                result.cupsJobId
            );

            if (submittedJob?.status === "cancelled") {
                await cancelPrint(result.cupsJobId).catch(() => {});
                await updatePrinterState({
                    state: "ready",
                    connected: true,
                    activeJobId: undefined,
                    message: "Print rejected before submission completed",
                    lastError: undefined
                });
                return;
            }
        }

        await monitorCupsJob(
            job._id,
            result.cupsJobId,
            job
        );
    } catch (error) {
        console.error("Print failed:", error.message);

        await updatePrinterState({
            state: error.code === "ENOENT" ? "offline" : "error",
            connected: false,
            activeJobId: job._id,
            message: error.message,
            lastError: error.message
        }).catch(() => {});

        await updateJobStatus(
            job._id,
            "failed",
            {
                error: error.message
            }
        );
    }
}


/*
|--------------------------------------------------------------------------
| Monitor CUPS
|--------------------------------------------------------------------------
*/

async function monitorCupsJob(
    jobId,
    cupsJobId,
    job
) {

    if (!cupsJobId) {

        await updateJobStatus(
            jobId,
            "completed"
        );

        await markOrderStatus(job, "READY");

        await acknowledgePrintedFile(job);

        await updatePrinterState({
            state: "ready",
            connected: true,
            activeJobId: undefined,
            message: "Print completed",
            lastError: undefined
        });

        return;
    }


    /*
    |--------------------------------------------------------------------------
    | Check every 2 seconds
    |--------------------------------------------------------------------------
    */

    for (;;) {

        await sleep(2000);


        try {

            const latestJob = await getPrintJob(jobId);
            if (!latestJob || latestJob.status === "cancelled") {
                await updatePrinterState({
                    state: "ready",
                    connected: true,
                    activeJobId: undefined,
                    message: "Print cancelled",
                    lastError: undefined
                });
                await processQueue();
                break;
            }

            const stdout = await getQueueStatus();


            /*
            |--------------------------------------------------------------------------
            | Still present = printing
            |--------------------------------------------------------------------------
            */

            if (
                stdout.includes(
                    cupsJobId
                )
            ) {

                continue;
            }


            /*
            |--------------------------------------------------------------------------
            | No longer in queue
            |--------------------------------------------------------------------------
            */

            await updateJobStatus(
                jobId,
                "completed"
            );

            await markOrderStatus(job, "READY");

            await acknowledgePrintedFile(job);

            await updatePrinterState({
                state: "ready",
                connected: true,
                activeJobId: undefined,
                message: "Print completed",
                lastError: undefined
            });


            console.log(
                "Print completed:",
                jobId
            );


            /*
            |--------------------------------------------------------------------------
            | Start next job
            |--------------------------------------------------------------------------
            */

            await processQueue();


            break;


        } catch (error) {

            /*
            |--------------------------------------------------------------------------
            | If lpstat doesn't find job, consider completed
            |--------------------------------------------------------------------------
            */

            await updatePrinterState({
                state: error.code === "ENOENT" ? "offline" : "error",
                connected: false,
                activeJobId: jobId,
                message: error.message,
                lastError: error.message
            });

            if (error.code === "ENOENT") {
                await updateJobStatus(
                    jobId,
                    "failed",
                    {
                        error: `Printer monitoring failed: ${error.message}`
                    }
                );

                break;
            }

            await sleep(5000);

            continue;
        }
    }
}


/*
|--------------------------------------------------------------------------
| Sleep
|--------------------------------------------------------------------------
*/

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

function resolveJobFolder(job) {
    if (FOLDERS.includes(job.folder)) {
        return job.folder;
    }

    const sourceFile = String(job.file || "");
    const folderFromUrl = sourceFile.match(
        /\/uploads\/(normal|express|cash)(?:\/|$)/i
    );

    if (folderFromUrl) {
        return folderFromUrl[1].toLowerCase();
    }

    if (FOLDERS.includes(job.options?.folder)) {
        return job.options.folder;
    }

    return "normal";
}

async function markOrderStatus(job, status) {
    if (!job?.orderId) {
        return;
    }

    try {
        const result = await updateOrderStatus(job.orderId, status);
        if (result.matchedCount === 0) {
            console.warn("Order not found while updating status:", job.orderId, status);
        }
    } catch (error) {
        console.error("Order status update failed:", error.message);
    }
}


/*
|--------------------------------------------------------------------------
| Polling
|--------------------------------------------------------------------------
*/

let isChecking =
    false;


async function pollServer() {

    if (
        isChecking
    ) {

        return;
    }


    isChecking = true;


    try {

        /*
        |--------------------------------------------------------------------------
        | Process local queue
        |--------------------------------------------------------------------------
        */

        await processQueue();


    } catch (error) {

        console.error(
            "Polling error:",
            error.message
        );

    } finally {

        isChecking =
            false;
    }
}


/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

async function start() {

    console.log("");
    console.log(
        "================================"
    );

    console.log(
        "UniKart Printer Client"
    );

    console.log(
        "================================"
    );

    console.log(
        "Server:",
        SERVER_URL
    );

    console.log(
        "MongoDB:",
        process.env.MONGO_URI
    );

    console.log(
        "Printer:",
        process.env.PRINTER_NAME
    );

    console.log(
        "Download:",
        DOWNLOAD_DIR
    );

    console.log(
        "Poll:",
        POLL_INTERVAL,
        "ms"
    );

    console.log(
        "Dashboard:",
        `http://localhost:${PORT}/dashboard`
    );

    console.log(
        "================================"
    );


    /*
    |--------------------------------------------------------------------------
    | MongoDB
    |--------------------------------------------------------------------------
    */

    await connectDatabase();


    /*
    |--------------------------------------------------------------------------
    | HTTP server
    |--------------------------------------------------------------------------
    */

    app.get(
        "/",
        (req, res) => {

            res.json({

                success: true,

                service:
                    "UniKart Printer Client",

                dashboard:
                    "/dashboard"

            });

        }
    );


    app.listen(
        PORT,
        () => {

            console.log(
                `Dashboard server running on port ${PORT}`
            );
        }
    );


    /*
    |--------------------------------------------------------------------------
    | Initial queue processing
    |--------------------------------------------------------------------------
    */

    await recoverPrinterJob();
    await processQueue();


    /*
    |--------------------------------------------------------------------------
    | Correct polling interval
    |--------------------------------------------------------------------------
    */

    setInterval(
        pollServer,
        POLL_INTERVAL
    );
}


start();