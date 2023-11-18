import { readFile, rm, mkdir, copyFile, chmod, writeFile } from 'node:fs/promises';
import { exec as execImpl } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execImpl);

const main = async () => {
    // Look up release data.
    const releaseLookup = await fetch('https://api.github.com/repos/gotson/komga/releases/latest');
    const releaseData = await releaseLookup.json();

    const newVersion = releaseData.tag_name;

    // Compare versions.
    const versionFile = await readFile('current.txt');
    if (versionFile.toString() === newVersion) {
        console.log('Version match. Exiting.');
        return;
    }

    // Ensure that no output from an older build remains.
    const workingDirs = ['deb', 'tmp'];
    const dirRemovals = workingDirs.map(
        (dir) => rm(dir, {recursive: true, force:true})
    );
    await Promise.all(dirRemovals);

    await mkdir('deb', {mode: 0o755});

    // Download the binary while we prepare the rest of the package.
    await mkdir('tmp/usr/share/java', {recursive: true, mode: 0o750});
    const binaryLookup = await fetch(
        `https://github.com/gotson/komga/releases/download/${newVersion}/komga-${newVersion}.jar`
    );
    const binaryBuffer = Buffer.from(await binaryLookup.arrayBuffer());
    const binaryWriter = writeFile('tmp/usr/share/java/komga.jar', binaryBuffer, {mode: 0x755});

    // Prep the DEBIAN dir.
    await mkdir('tmp/DEBIAN', {recursive: true, mode: 0o755});
    const DEBIANfiles = ['postinst', 'postrm', 'preinst', 'prerm'];
    const DEBIANfileCopies = DEBIANfiles.map(
        (file) => copyFile(`DEBIAN/${file}`, `tmp/DEBIAN/${file}`)
    );
    await Promise.all(DEBIANfileCopies);
    const DEBIANfileChmods =  DEBIANfiles.map(
        (file) => chmod(`tmp/DEBIAN/${file}`, 0o755)
    );
    await Promise.all(DEBIANfileChmods);

    // Copy our systemd service.
    await mkdir('tmp/etc/systemd/system', {recursive: true, mode: 0o750});
    await copyFile('komga.service', 'tmp/etc/systemd/system/komga.service');
    await chmod('tmp/etc/systemd/system/komga.service', 0o755);

    // Create a blank /var/lib/ directory.
    await mkdir('tmp/var/lib/komga', {recursive: true, mode: 0o750})

    // Wait for the binary download to finish.
    await binaryWriter;

    const DEBIANcontrolFile = await readFile('DEBIAN/control');
    const DEBIANcontrolData = DEBIANcontrolFile.toString();
    const architectures = ['all'];

    // Loop through the architectures and build each one.
    for (const architecture of architectures) {
        let editedControlData = DEBIANcontrolData.replaceAll(
            'VERSION-TO-REPLACE',
            newVersion
        );
        editedControlData = editedControlData.replaceAll(
            'ARCHI-TO-REPLACE',
            architecture
        );
        await writeFile('tmp/DEBIAN/control', editedControlData, {mode: 0o755});
        await exec('dpkg-deb --build tmp deb');
    }

    // Update the version number.
    await writeFile('current.txt', newVersion);
}

main().catch(console.error);