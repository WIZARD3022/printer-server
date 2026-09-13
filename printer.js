const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PRINTER_NAME = process.env.PRINTER_NAME;

const CAPABILITIES = {
    pageSizes: [
        "215x345mm", "3.5x5", "3.5x5.Borderless", "4x6",
        "4x6.Borderless", "5x7", "5x7.Borderless", "5x8",
        "5x8.Borderless", "A4", "A4.Borderless", "A5", "A6",
        "A6.Borderless", "Env10", "EnvC5", "EnvDL", "EnvMonarch",
        "Executive", "FanFoldGermanLegal", "Legal", "Letter",
        "Letter.Borderless", "Oficio", "Custom"
    ],
    inputSlots: ["Auto", "Main"],
    mediaTypes: ["Stationery", "PhotographicGlossy", "Stationery Inkjet", "Com.brotherBp71"],
    qualities: ["Draft", "Normal", "High"],
    colorModels: ["RGB", "Gray"],
    duplexModes: ["None", "DuplexNoTumble", "DuplexTumble"],
    outputBins: ["FaceUp"]
};

function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && value !== "");
}

function canonicalValue(value, values, aliases = {}) {
    const text = String(value);
    const alias = aliases[text.toLowerCase()];
    const candidate = alias || text;
    return values.find(option => option.toLowerCase() === candidate.toLowerCase()) || candidate;
}

function normalizeOptions(options = {}) {
    const pageSize = canonicalValue(
        firstValue(options.paperSize, options.pageSize, "A4"),
        CAPABILITIES.pageSizes,
        { "a4 borderless": "A4.Borderless" }
    );
    const color = canonicalValue(firstValue(
        options.colorModel,
        options.color === "monochrome" || options.printingType === "B&W" ? "Gray" : options.color,
        "RGB"
    ), CAPABILITIES.colorModels, { color: "RGB", monochrome: "Gray", bw: "Gray", "b&w": "Gray" });
    const duplex = canonicalValue(firstValue(
        options.duplexMode,
        options.duplex === true ? "DuplexNoTumble" : options.duplex,
        "None"
    ), CAPABILITIES.duplexModes, { none: "None", duplex: "DuplexNoTumble" });
    const quality = canonicalValue(firstValue(options.cupsPrintQuality, options.quality, "Normal"), CAPABILITIES.qualities);
    const inputSlot = canonicalValue(firstValue(options.inputSlot, options.mediaSource, "Auto"), CAPABILITIES.inputSlots);
    const mediaType = canonicalValue(firstValue(options.mediaType, "Stationery"), CAPABILITIES.mediaTypes, {
        stationery: "Stationery",
        photographic: "PhotographicGlossy",
        glossy: "PhotographicGlossy",
        inkjet: "Stationery Inkjet"
    });
    const outputBin = canonicalValue(firstValue(options.outputBin, "FaceUp"), CAPABILITIES.outputBins);
    const copies = Math.max(1, Math.min(999, Number(options.copies) || 1));

    if (!CAPABILITIES.pageSizes.includes(pageSize) || pageSize === "Custom") {
        throw new Error(`Unsupported paper size: ${pageSize}`);
    }

    if (!CAPABILITIES.colorModels.includes(color)) {
        throw new Error(`Unsupported color model: ${color}`);
    }

    if (!CAPABILITIES.duplexModes.includes(duplex)) {
        throw new Error(`Unsupported duplex mode: ${duplex}`);
    }

    if (!CAPABILITIES.qualities.includes(quality)) {
        throw new Error(`Unsupported print quality: ${quality}`);
    }

    if (!CAPABILITIES.inputSlots.includes(inputSlot)) {
        throw new Error(`Unsupported input slot: ${inputSlot}`);
    }

    if (!CAPABILITIES.mediaTypes.includes(mediaType)) {
        throw new Error(`Unsupported media type: ${mediaType}`);
    }

    return {
        copies,
        pageSize,
        inputSlot,
        mediaType,
        quality,
        color,
        duplex,
        outputBin
    };
}

function buildPrintCommand(filePath, options = {}) {
    if (!PRINTER_NAME) {
        throw new Error("PRINTER_NAME missing");
    }

    if (!filePath) {
        throw new Error("Print file path missing");
    }

    const printOptions = normalizeOptions(options);
    const args = [
        "-d", PRINTER_NAME,
        "-n", String(printOptions.copies),
        "-o", `PageSize=${printOptions.pageSize}`,
        "-o", `InputSlot=${printOptions.inputSlot}`,
        "-o", `MediaType=${printOptions.mediaType}`,
        "-o", `cupsPrintQuality=${printOptions.quality}`,
        "-o", `ColorModel=${printOptions.color}`,
        "-o", `Duplex=${printOptions.duplex}`,
        "-o", `OutputBin=${printOptions.outputBin}`,
        filePath
    ];

    return {
        executable: "lp",
        args,
        options: printOptions,
        command: `lp ${args.map(arg => JSON.stringify(arg)).join(" ")}`
    };
}

async function submitPrint(filePath, options = {}) {
    const printCommand = buildPrintCommand(filePath, options);
    const { stdout, stderr } = await execFileAsync(
        printCommand.executable,
        printCommand.args
    );

    return {
        ...printCommand,
        stdout,
        stderr,
        cupsJobId: stdout.match(/request id is\s+([^\s]+)/i)?.[1] || null
    };
}

async function getQueueStatus() {
    try {
        const { stdout } = await execFileAsync(
            "lpstat",
            ["-W", "not-completed", "-o", PRINTER_NAME]
        );

        return stdout;
    } catch (error) {
        if (error.code === 1) {
            return error.stdout || "";
        }

        throw error;
    }
}

async function getPrinterStatus() {
    if (!PRINTER_NAME) {
        return {
            connected: false,
            state: "error",
            message: "PRINTER_NAME missing"
        };
    }

    try {
        const { stdout } = await execFileAsync(
            "lpstat",
            ["-p", PRINTER_NAME]
        );

        const lower = stdout.toLowerCase();
        const paused = lower.includes("disabled") || lower.includes("paused");

        return {
            connected: true,
            state: paused ? "paused" : "ready",
            message: stdout.trim()
        };
    } catch (error) {
        const notInstalled = error.code === "ENOENT";

        return {
            connected: false,
            state: notInstalled ? "offline" : "error",
            message: notInstalled
                ? "CUPS commands are not installed or not in PATH"
                : error.stderr || error.message
        };
    }
}

module.exports = {
    CAPABILITIES,
    buildPrintCommand,
    getQueueStatus,
    getPrinterStatus,
    normalizeOptions,
    submitPrint
};