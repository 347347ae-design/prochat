# 用 aapt2 + javac + d8 + apksigner 直接打包，不依赖 Gradle
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = $PSScriptRoot
$ksPass = $env:PROCHAT_KS_PASS
if (-not $ksPass) {
    $localSigning = Join-Path $root 'build.local.ps1'
    if (Test-Path $localSigning) { . $localSigning }
}
if (-not $ksPass) {
    throw '缺少签名密码：设置环境变量 PROCHAT_KS_PASS，或创建 build.local.ps1（不要提交）。'
}
$sdk = 'C:\Users\Administrator\.workbuddy-ai\binaries\android-sdk'
$bt = Join-Path $sdk 'build-tools\34.0.0'
$androidJar = Join-Path $sdk 'platforms\android-34\android.jar'
$jdk = 'C:\Program Files\Zulu\zulu-17'
$javac = Join-Path $jdk 'bin\javac.exe'
$keytool = Join-Path $jdk 'bin\keytool.exe'

$build = Join-Path $root 'build'
$dist = Join-Path $root 'dist'
$ks = Join-Path $root 'prochat.jks'
$apkName = 'ProChat-1.2.2.apk'

if (Test-Path $build) { Remove-Item -Recurse -Force $build }
New-Item -ItemType Directory -Force -Path $build, $dist,
    (Join-Path $build 'classes'), (Join-Path $build 'dex') | Out-Null

Write-Host '== 1/7 编译资源' -ForegroundColor Cyan
& (Join-Path $bt 'aapt2.exe') compile --dir (Join-Path $root 'res') -o (Join-Path $build 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile 失败' }

Write-Host '== 2/7 链接资源 + 清单 + assets' -ForegroundColor Cyan
& (Join-Path $bt 'aapt2.exe') link -o (Join-Path $build 'base.apk') `
    -I $androidJar `
    --manifest (Join-Path $root 'AndroidManifest.xml') `
    -A (Join-Path $root 'assets') `
    (Join-Path $build 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link 失败' }

Write-Host '== 3/7 编译 Java' -ForegroundColor Cyan
$sources = Get-ChildItem -Recurse (Join-Path $root 'java') -Filter *.java | ForEach-Object { $_.FullName }
$srcList = Join-Path $build 'sources.txt'
[System.IO.File]::WriteAllLines($srcList, $sources, (New-Object System.Text.UTF8Encoding($false)))
& $javac -encoding UTF-8 -source 8 -target 8 -nowarn -Xlint:none `
    -classpath $androidJar -d (Join-Path $build 'classes') "@$srcList"
if ($LASTEXITCODE -ne 0) { throw 'javac 失败' }

Write-Host '== 4/7 d8 生成 dex' -ForegroundColor Cyan
$classes = Get-ChildItem -Recurse (Join-Path $build 'classes') -Filter *.class | ForEach-Object { $_.FullName }
$dexOut = Join-Path $build 'dex'
& (Join-Path $bt 'd8.bat') --release --min-api 24 --lib $androidJar --output $dexOut @classes
if ($LASTEXITCODE -ne 0) { throw 'd8 失败' }

# 把 dex 塞进 apk
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apkPath = Join-Path $build 'base.apk'
$zip = [System.IO.Compression.ZipFile]::Open($apkPath, 'Update')
$existing = $zip.GetEntry('classes.dex')
if ($existing) { $existing.Delete() }
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, (Join-Path $dexOut 'classes.dex'), 'classes.dex',
    [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
$zip.Dispose()

Write-Host '== 5/7 规范化 assets 路径' -ForegroundColor Cyan
# aapt2 在 Windows 上会把 -A 的子目录写成反斜杠，Android AssetManager 只认正斜杠。
# 这里统一重新写入 assets，保证 file:///android_asset/katex/... 能访问。
$zip = [System.IO.Compression.ZipFile]::Open($apkPath, 'Update')
$oldAssets = @($zip.Entries | Where-Object { $_.FullName -like 'assets*' })
foreach ($e in $oldAssets) { $e.Delete() }
$assetRoot = Join-Path $root 'assets'
Get-ChildItem -Recurse -File $assetRoot | ForEach-Object {
    $rel = $_.FullName.Substring($assetRoot.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $_.FullName, ('assets/' + $rel),
        [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
$zip.Dispose()

Write-Host '== 6/7 zipalign' -ForegroundColor Cyan
$aligned = Join-Path $build 'aligned.apk'
& (Join-Path $bt 'zipalign.exe') -f -p 4 $apkPath $aligned
if ($LASTEXITCODE -ne 0) { throw 'zipalign 失败' }

Write-Host '== 7/7 签名' -ForegroundColor Cyan
if (-not (Test-Path $ks)) {
    & $keytool -genkeypair -keystore $ks -alias prochat -keyalg RSA -keysize 2048 `
        -validity 12000 -storepass $ksPass -keypass $ksPass `
        -dname 'CN=ProChat, OU=Local, O=Local, L=Local, ST=Local, C=CN'
    if ($LASTEXITCODE -ne 0) { throw '生成签名失败' }
}
$outApk = Join-Path $dist $apkName
if (Test-Path $outApk) { Remove-Item -Force $outApk }
& (Join-Path $bt 'apksigner.bat') sign `
    --ks $ks --ks-key-alias prochat `
    --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" `
    --v1-signing-enabled true --v2-signing-enabled true `
    --out $outApk $aligned
if ($LASTEXITCODE -ne 0) { throw 'apksigner 失败' }

$verifyOutput = & (Join-Path $bt 'apksigner.bat') verify --print-certs $outApk 2>&1
$verifyOutput | Select-Object -First 4
if ($LASTEXITCODE -ne 0) { throw 'APK 验签失败' }

$size = [math]::Round((Get-Item $outApk).Length / 1MB, 2)
Write-Host ''
Write-Host "完成: $outApk  ($size MB)" -ForegroundColor Green
