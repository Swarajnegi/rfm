// Builds the installable APK and leaves it at the repo root as rfm-app.apk.
//
//     npm run apk
//     npm run apk -- --release     (unsigned; a device will refuse to install it)
//     adb install -r rfm-app.apk
//
// It is one command because it is three ordered steps whose failure mode is SILENT:
// `cap sync` only COPIES web/ into the Android project, so skipping `npm run build`
// first ships the previous vendor bundle inside a fresh-looking APK.
//
// WHY THE JDK IS RESOLVED HERE: the project needs Java 21 (app/build.gradle,
// sourceCompatibility VERSION_21). On the machine this was written for, `java` on
// PATH was 21 while JAVA_HOME still pointed at an 11 install, and Gradle reads
// JAVA_HOME — producing a class-version error that names neither. The right JDK is
// found and passed for this invocation only; nothing else is changed.
//
// WHY THE OUTPUT IS OPENED AND CHECKED — this is the important part.
// Gradle reported BUILD SUCCESSFUL with an asset merge that was up-to-date against
// an EARLIER `cap sync`, and the resulting APK contained no `assets/native-bridge.js`,
// no `capacitor.config.json` and no `capacitor.plugins.json`. native-bridge.js is what
// defines `Capacitor.nativePromise`, so on the device EVERY plugin call died with
// "e.nativePromise is not a function" and no price would sync. Nothing about the web
// layer was wrong, and no amount of testing it could have found this: the defect was
// entirely in what got packaged. An exit code is not evidence. The package is opened.
//
// The APK is a build artefact and is gitignored (`*.apk`).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, copyFileSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const ANDROID = path.join(ROOT, 'android');
const OUT = path.join(ROOT, 'rfm-app.apk');
const RELEASE = process.argv.includes('--release');
const WIN = os.platform() === 'win32';

const run = (cmd, args, opts = {}) => {
    console.log(`\n  $ ${cmd} ${args.join(' ')}`);
    execFileSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
};

// ── Find a JDK 21+ ───────────────────────────────────────────────────────────
function javaHome() {
    // `java -version` prints to STDERR, not stdout, and shell:true does not quote a
    // path containing "Program Files". Getting either wrong makes every JDK on the
    // machine look absent, which is what happened the first time this ran.
    const ok = home => {
        if (!home || !existsSync(home)) return false;
        const exe = path.join(home, 'bin', WIN ? 'java.exe' : 'java');
        if (!existsSync(exe)) return false;
        const r = spawnSync(exe, ['-version'], { encoding: 'utf8' });
        const major = Number(/version "(\d+)/.exec(`${r.stderr || ''}${r.stdout || ''}`)?.[1]);
        return Number.isFinite(major) && major >= 21;
    };
    if (ok(process.env.JAVA_HOME)) return process.env.JAVA_HOME;

    const first = spawnSync(WIN ? 'where' : 'which', ['java'], { encoding: 'utf8', shell: true })
        .stdout?.split(String.fromCharCode(10))[0].trim();
    if (first) {
        const home = path.dirname(path.dirname(first));
        if (ok(home)) return home;
    }
    const roots = WIN
        ? ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java', 'C:\\Program Files\\Microsoft']
        : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];
    for (const r of roots) {
        if (!existsSync(r)) continue;
        for (const d of readdirSync(r)) {
            for (const home of [path.join(r, d), path.join(r, d, 'Contents', 'Home')]) {
                if (ok(home)) return home;
            }
        }
    }
    return null;
}

// ── A minimal zip reader, so the package can be inspected without a dependency ─
function readApk(file) {
    const buf = readFileSync(file);
    let end = buf.length - 22;
    while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0) throw new Error(`${path.basename(file)} is not a zip`);
    const count = buf.readUInt16LE(end + 10);
    let off = buf.readUInt32LE(end + 16);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
        const method = buf.readUInt16LE(off + 10);
        const compSize = buf.readUInt32LE(off + 20);
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const cmtLen = buf.readUInt16LE(off + 32);
        const local = buf.readUInt32LE(off + 42);
        entries.set(buf.toString('utf8', off + 46, off + 46 + nameLen), { method, compSize, local });
        off += 46 + nameLen + extraLen + cmtLen;
    }
    const read = name => {
        const e = entries.get(name);
        if (!e) return null;
        const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
        const raw = buf.subarray(start, start + e.compSize);
        return e.method === 0 ? raw : inflateRawSync(raw);
    };
    return { entries, read };
}

const sha = b => createHash('sha256').update(b).digest('hex').slice(0, 12);

// Each check answers "would this run on a device", not "did Gradle exit 0".
function inspect(file) {
    const { entries, read } = readApk(file);
    const problems = [];
    // native-bridge.js is the one whose absence is invisible until every plugin fails.
    for (const need of ['assets/native-bridge.js', 'assets/capacitor.config.json',
                        'assets/capacitor.plugins.json', 'assets/public/index.html',
                        'assets/public/app.js', 'AndroidManifest.xml', 'classes.dex']) {
        if (!entries.has(need)) problems.push(`missing ${need}`);
    }
    if (entries.has('assets/native-bridge.js')) {
        const bridge = read('assets/native-bridge.js').toString('utf8');
        if (!bridge.includes('nativePromise')) problems.push('native-bridge.js defines no nativePromise');
    }
    // The packaged web layer must be the one on disk, not a previous sync.
    for (const f of ['index.html', 'app.js', 'plugins.js', 'corpus.css', 'motion.js', 'parser.js', 'ai-service-config.js',
                     'regenWealth.js', 'research.js', 'schemes.js']) {
        const packed = read(`assets/public/${f}`);
        if (!packed) { problems.push(`missing assets/public/${f}`); continue; }
        if (sha(packed) !== sha(readFileSync(path.join(ROOT, 'web', f)))) {
            problems.push(`assets/public/${f} is stale`);
        }
    }
    return problems;
}

// ── Build ────────────────────────────────────────────────────────────────────
const JAVA_HOME = javaHome();
if (!JAVA_HOME) {
    console.error('\n  No JDK 21 or newer found. Gradle needs one (app/build.gradle targets 21).');
    console.error('  Install Temurin 21, or set JAVA_HOME to an existing 21+ JDK.\n');
    process.exit(1);
}
console.log(`  JDK: ${JAVA_HOME}`);

const gradlew = JSON.stringify(path.join(ANDROID, WIN ? 'gradlew.bat' : 'gradlew'));
const task = RELEASE ? 'assembleRelease' : 'assembleDebug';
const built = path.join(ANDROID, 'app', 'build', 'outputs', 'apk',
                        RELEASE ? 'release' : 'debug',
                        RELEASE ? 'app-release-unsigned.apk' : 'app-debug.apk');
const gradleEnv = { cwd: ANDROID, env: { ...process.env, JAVA_HOME } };

run('npm', ['run', 'build']);            // the web bundle FIRST — cap sync only copies
run('npx', ['cap', 'sync', 'android']);  // copy web/ in, refresh plugins and the bridge
run(gradlew, [task, '--no-daemon'], gradleEnv);

if (!existsSync(built)) {
    console.error(`\n  Gradle succeeded but ${path.relative(ROOT, built)} is missing.\n`);
    process.exit(1);
}

let problems = inspect(built);
if (problems.length) {
    console.log('\n  The package is wrong despite a successful build:');
    for (const p of problems) console.log(`    - ${p}`);
    console.log("  Gradle's incremental state is stale. Rebuilding clean.\n");
    run(gradlew, ['clean', task, '--no-daemon'], gradleEnv);
    problems = inspect(built);
}
if (problems.length) {
    console.error('\n  Still wrong after a clean build:');
    for (const p of problems) console.error(`    - ${p}`);
    console.error('');
    process.exit(1);
}

copyFileSync(built, OUT);
console.log(`\n  rfm-app.apk  ${(statSync(OUT).size / 1048576).toFixed(1)} MiB  ` +
            `(${RELEASE ? 'release, UNSIGNED' : 'debug, installable'})`);
console.log('  verified: native bridge packaged, web layer matches web/ on disk');
console.log('  install with:  adb install -r rfm-app.apk\n');
