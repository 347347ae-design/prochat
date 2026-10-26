# 生成启动图标（PNG 各密度 + Android 8+ 自适应图标）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$res = Join-Path $root 'res'

function New-RoundedPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-Icon([int]$size, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # 背景渐变圆角方块
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $c1 = [System.Drawing.Color]::FromArgb(255, 76, 141, 255)
    $c2 = [System.Drawing.Color]::FromArgb(255, 124, 92, 255)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45)
    $bg = New-RoundedPath 0 0 $size $size ([int]($size * 0.23))
    $g.FillPath($brush, $bg)

    # 白色对话气泡
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $bx = [int]($size * 0.20)
    $by = [int]($size * 0.24)
    $bw = [int]($size * 0.60)
    $bh = [int]($size * 0.40)
    $bubble = New-RoundedPath $bx $by $bw $bh ([int]($size * 0.15))
    $g.FillPath($white, $bubble)
    # 尾巴
    $tail = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tx = [int]($size * 0.31)
    $ty = $by + $bh - 2
    $tail.AddPolygon(@(
        (New-Object System.Drawing.Point($tx, $ty)),
        (New-Object System.Drawing.Point(($tx - [int]($size * 0.04)), ($ty + [int]($size * 0.13)))),
        (New-Object System.Drawing.Point(($tx + [int]($size * 0.13)), $ty))
    ))
    $g.FillPath($white, $tail)

    # 三个圆点
    $dot = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 92, 118, 255))
    $cy = $by + [int]($bh / 2)
    $r = $size * 0.033
    foreach ($k in @(0.38, 0.50, 0.62)) {
        $cx = $bx + [int]($bw * $k)
        $g.FillEllipse($dot, $cx - $r, $cy - $r, $r * 2, $r * 2)
    }

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$sizes = @{
    'mipmap-mdpi'    = 48
    'mipmap-hdpi'    = 72
    'mipmap-xhdpi'   = 96
    'mipmap-xxhdpi'  = 144
    'mipmap-xxxhdpi' = 192
}

foreach ($k in $sizes.Keys) {
    $dir = Join-Path $res $k
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    New-Icon $sizes[$k] (Join-Path $dir 'ic_launcher.png')
    Write-Host "$k -> $($sizes[$k])px"
}

# 自适应图标（Android 8+）
$v26 = Join-Path $res 'mipmap-anydpi-v26'
$drawable = Join-Path $res 'drawable'
New-Item -ItemType Directory -Force -Path $v26, $drawable | Out-Null

@'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_bg" />
    <foreground android:drawable="@drawable/ic_launcher_fg" />
</adaptive-icon>
'@ | Set-Content -Path (Join-Path $v26 'ic_launcher.xml') -Encoding UTF8

@'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <gradient
        android:angle="45"
        android:startColor="#4C8DFF"
        android:endColor="#7C5CFF"
        android:type="linear" />
</shape>
'@ | Set-Content -Path (Join-Path $drawable 'ic_launcher_bg.xml') -Encoding UTF8

@'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M42,33 h24 a11,11 0 0 1 11,11 v12 a11,11 0 0 1 -11,11 h-13 l-9,9 v-9 h-2 a11,11 0 0 1 -11,-11 v-12 a11,11 0 0 1 11,-11 z" />
    <path
        android:fillColor="#5C76FF"
        android:pathData="M45,50 m-2.6,0 a2.6,2.6 0 1,0 5.2,0 a2.6,2.6 0 1,0 -5.2,0" />
    <path
        android:fillColor="#5C76FF"
        android:pathData="M54,50 m-2.6,0 a2.6,2.6 0 1,0 5.2,0 a2.6,2.6 0 1,0 -5.2,0" />
    <path
        android:fillColor="#5C76FF"
        android:pathData="M63,50 m-2.6,0 a2.6,2.6 0 1,0 5.2,0 a2.6,2.6 0 1,0 -5.2,0" />
</vector>
'@ | Set-Content -Path (Join-Path $drawable 'ic_launcher_fg.xml') -Encoding UTF8

Write-Host '图标生成完成'
