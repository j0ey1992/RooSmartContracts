import { existsSync } from 'fs';
import { mkdir, copyFile, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Source and destination paths
const sourceDir = join(__dirname, 'node_modules', '@openzeppelin', 'contracts-upgradeable');
const destDir = join(__dirname, 'contracts', 'upgradeable');

// Create destination directory if it doesn't exist
if (!existsSync(destDir)) {
    await mkdir(destDir, { recursive: true });
}

// Function to copy directory recursively
async function copyDir(src, dest) {
    try {
        const entries = await readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = join(src, entry.name);
            const destPath = join(dest, entry.name);

            if (entry.isDirectory()) {
                await mkdir(destPath, { recursive: true });
                await copyDir(srcPath, destPath);
            } else {
                await copyFile(srcPath, destPath);
            }
        }
    } catch (err) {
        console.error('Error copying directory:', err);
    }
}

// IIFE to use await at top level
(async () => {
    try {
        if (existsSync(sourceDir)) {
            await copyDir(sourceDir, destDir);
            console.log('Contracts copied successfully!');
        } else {
            console.error('Source directory not found!');
        }
    } catch (err) {
        console.error('Error:', err);
    }
})();
