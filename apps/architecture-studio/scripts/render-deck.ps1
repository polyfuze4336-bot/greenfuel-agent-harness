# Renders a .pptx with the installed Microsoft PowerPoint and measures it. Windows only; PowerPoint must be installed.
#
#   render-deck.ps1 -Pptx <file> -OutDir <folder>
#
# Writes into OutDir: deck.pdf, slide-001.png ..., and layout.json: for every shape with text, the box PowerPoint gave it and the
# height and width the text actually needs. That is PowerPoint's own measurement, so it is the authority on overflow.
param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Width = 1920,
  [int]$Height = 1080
)
$ErrorActionPreference = 'Stop'
$Pptx = (Resolve-Path -LiteralPath $Pptx).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

$app = $null
$pres = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  # msoTrue for ReadOnly, Untitled, WithWindow = false: no window, and the file on disk is never modified.
  $pres = $app.Presentations.Open($Pptx, -1, 0, 0)
  $pres.SaveAs((Join-Path $OutDir 'deck.pdf'), 32)
  $pres.Export($OutDir, 'PNG', $Width, $Height)

  $pxPerPt = 1
  $slides = @()
  foreach ($s in $pres.Slides) {
    $shapes = @()
    foreach ($sh in $s.Shapes) {
      $hasText = $false
      $bh = 0.0; $bw = 0.0; $size = 0.0; $text = ''
      if ($sh.HasTextFrame -eq -1 -and $sh.TextFrame2.HasText -eq -1) {
        $hasText = $true
        $r = $sh.TextFrame2.TextRange
        $bh = [math]::Round($r.BoundHeight, 2)
        $bw = [math]::Round($r.BoundWidth, 2)
        $size = [math]::Round($r.Font.Size, 1)
        $text = $r.Text
        if ($text.Length -gt 160) { $text = $text.Substring(0, 160) }
      }
      $shapes += [pscustomobject]@{
        name = $sh.Name; type = [int]$sh.Type; left = [math]::Round($sh.Left, 2); top = [math]::Round($sh.Top, 2)
        width = [math]::Round($sh.Width, 2); height = [math]::Round($sh.Height, 2)
        hasText = $hasText; textHeight = $bh; textWidth = $bw; fontSize = $size; text = $text
        marginTop = if ($hasText) { [math]::Round($sh.TextFrame2.MarginTop, 2) } else { 0 }
        marginBottom = if ($hasText) { [math]::Round($sh.TextFrame2.MarginBottom, 2) } else { 0 }
        marginLeft = if ($hasText) { [math]::Round($sh.TextFrame2.MarginLeft, 2) } else { 0 }
        marginRight = if ($hasText) { [math]::Round($sh.TextFrame2.MarginRight, 2) } else { 0 }
        autoSize = if ($hasText) { [int]$sh.TextFrame2.AutoSize } else { 0 }
        wordWrap = if ($hasText) { [int]$sh.TextFrame2.WordWrap } else { 0 }
      }
    }
    $notes = ''
    try { $notes = $s.NotesPage.Shapes.Placeholders(2).TextFrame.TextRange.Text } catch { $notes = '' }
    $slides += [pscustomobject]@{ index = $s.SlideIndex; shapes = $shapes; notesLength = $notes.Length }
  }
  $layout = [pscustomobject]@{
    slideWidth = $pres.PageSetup.SlideWidth; slideHeight = $pres.PageSetup.SlideHeight
    powerpointVersion = $app.Version; slides = $slides
  }
  $layout | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir 'layout.json') -Encoding UTF8

  # PowerPoint names exported files Slide1.PNG; give them a stable, sortable name.
  Get-ChildItem -Path $OutDir -Filter 'Slide*.PNG' | ForEach-Object {
    $n = [int]($_.BaseName -replace '\D', '')
    Move-Item -Force -LiteralPath $_.FullName -Destination (Join-Path $OutDir ('slide-{0:000}.png' -f $n))
  }
}
finally {
  if ($pres) { $pres.Close() }
  if ($app) { $app.Quit() }
  if ($pres) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pres) }
  if ($app) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
}
