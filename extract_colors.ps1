Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('D:\Docker\Ubuntu\StrikeCapital\logo.png')
Write-Host "Size: $($img.Width)x$($img.Height)"
$small = New-Object System.Drawing.Bitmap($img, 50, 22)
$colors = @{}
for($x=0; $x -lt 50; $x++) {
  for($y=0; $y -lt 22; $y++) {
    $c = $small.GetPixel($x,$y)
    if($c.A -gt 128) {
      $r = [int]([Math]::Round($c.R/16)*16)
      $g = [int]([Math]::Round($c.G/16)*16)
      $b = [int]([Math]::Round($c.B/16)*16)
      $hex = '#{0:X2}{1:X2}{2:X2}' -f [Math]::Min($r,255),[Math]::Min($g,255),[Math]::Min($b,255)
      if(-not $colors.ContainsKey($hex)){$colors[$hex]=0}
      $colors[$hex]++
    }
  }
}
Write-Host "---TOP COLORS---"
$colors.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15 | ForEach-Object { Write-Host "$($_.Key): $($_.Value)" }
$img.Dispose()
$small.Dispose()
