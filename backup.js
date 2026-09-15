const fs = require("fs");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
const { promisify } = require("util");

const {
    upsertBackup,
    getBackup,
    getRecentBackups
} = require("./database");

const execFileAsync = promisify(execFile);
const BACKUP_DIR = path.resolve(
    process.env.BACKUP_DIR || "/run/media/server/E03066CF3066ABEA/mongodb-backups"
);
const BACKUP_MOUNT_PATH = path.resolve(
    process.env.BACKUP_MOUNT_PATH || "/run/media/server/E03066CF3066ABEA"
);

function getBackupDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

function getNextScheduledBackup() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "numeric",
        day: "numeric"
    }).formatToParts(now).reduce((result, part) => {
        result[part.type] = Number(part.value);
        return result;
    }, {});

    const todayAtBackupTime = new Date(
        Date.UTC(parts.year, parts.month - 1, parts.day, 7, 30)
    );

    if (todayAtBackupTime <= now) {
        todayAtBackupTime.setUTCDate(todayAtBackupTime.getUTCDate() + 1);
    }

    return todayAtBackupTime;
}

function verifyBackupDrive() {
    if (process.platform === "linux") {
        try {
            execFileSync("mountpoint", ["-q", BACKUP_MOUNT_PATH]);
        } catch {
            throw new Error(`Backup SSD is not mounted at ${BACKUP_MOUNT_PATH}`);
        }
    }

    if (!fs.existsSync(BACKUP_MOUNT_PATH)) {
        throw new Error(`Backup SSD mount path is unavailable: ${BACKUP_MOUNT_PATH}`);
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.accessSync(BACKUP_DIR, fs.constants.R_OK | fs.constants.W_OK);

    const probePath = path.join(
        BACKUP_DIR,
        `.backup-check-${process.pid}`
    );
    fs.writeFileSync(probePath, "ok");
    fs.unlinkSync(probePath);
}

async function getDirectorySize(directory) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    let total = 0;

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            total += await getDirectorySize(entryPath);
        } else {
            total += (await fs.promises.stat(entryPath)).size;
        }
    }

    return total;
}

async function removeOldBackups() {
    const entries = (await fs.promises.readdir(BACKUP_DIR, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
        .sort((first, second) => second.name.localeCompare(first.name));

    for (const entry of entries.slice(3)) {
        await fs.promises.rm(path.join(BACKUP_DIR, entry.name), {
            recursive: true,
            force: true
        });
    }
}

async function backupDatabase({ trigger = "scheduled", backupDate = getBackupDate() } = {}) {
    const targetPath = path.join(BACKUP_DIR, backupDate);
    const stagingPath = path.join(
        BACKUP_DIR,
        `.staging-${backupDate}-${process.pid}-${Date.now()}`
    );

    try {
        verifyBackupDrive();
        await upsertBackup(backupDate, {
            status: "running",
            path: targetPath,
            error: undefined,
            trigger
        });

        await fs.promises.mkdir(stagingPath, { recursive: true });
        await execFileAsync(
            "mongodump",
            [
                `--uri=${process.env.MONGO_URI}`,
                `--out=${stagingPath}`
            ],
            { timeout: 15 * 60 * 1000 }
        );

        await fs.promises.rm(targetPath, { recursive: true, force: true });
        await fs.promises.rename(stagingPath, targetPath);

        const size = await getDirectorySize(targetPath);
        await upsertBackup(backupDate, {
            status: "completed",
            path: targetPath,
            size,
            error: undefined,
            trigger,
            completedAt: new Date()
        });
        await removeOldBackups();

        return {
            success: true,
            backupDate,
            path: targetPath,
            size
        };
    } catch (error) {
        await fs.promises.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
        await upsertBackup(backupDate, {
            status: "pending",
            path: targetPath,
            error: error.message,
            trigger
        }).catch(() => {});

        return {
            success: false,
            backupDate,
            pending: true,
            error: error.message
        };
    }
}

function scheduleDailyBackup() {
    const scheduleNext = () => {
        const delay = Math.max(1000, getNextScheduledBackup().getTime() - Date.now());
        setTimeout(async () => {
            await backupDatabase({ trigger: "scheduled" });
            scheduleNext();
        }, delay);
    };

    scheduleNext();
}

module.exports = {
    BACKUP_DIR,
    backupDatabase,
    getBackup,
    getRecentBackups,
    scheduleDailyBackup,
    verifyBackupDrive
};
