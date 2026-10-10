# Always listening: runs only while Dude is switched on. Uses Windows speech recognition, on this laptop.
# Prints one line per sentence it hears ("OK:<confidence>:<text>"). Nothing is recorded or saved.
# While the pause file exists (Dude is talking), the microphone is let go so he doesn't hear himself.
param([string]$PauseFile = '')
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$inv = [System.Globalization.CultureInfo]::InvariantCulture
function Say([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
try { Add-Type -AssemblyName System.Speech } catch { Say 'ERR:norecognizer'; exit }
try {
  $all = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $info = $all | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq 'en' } | Select-Object -First 1
  if (-not $info) { $info = $all | Select-Object -First 1 }
  if (-not $info) { Say 'ERR:norecognizer'; exit }
  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
} catch { Say 'ERR:norecognizer'; exit }
try { $r.SetInputToDefaultAudioDevice() } catch { Say 'ERR:nomic'; exit }
$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(3)
$r.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(700)
$r.BabbleTimeout = [TimeSpan]::FromSeconds(12)
Say 'READY'
$paused = $false
while ($true) {
  if ($PauseFile -and (Test-Path -LiteralPath $PauseFile)) {
    if (-not $paused) { try { $r.SetInputToNull() } catch {}; $paused = $true }
    Start-Sleep -Milliseconds 120
    continue
  }
  if ($paused) {
    try { $r.SetInputToDefaultAudioDevice() } catch { Say 'ERR:nomic'; exit }
    $paused = $false
  }
  $res = $null
  try { $res = $r.Recognize([TimeSpan]::FromSeconds(14)) } catch { Start-Sleep -Milliseconds 300; continue }
  if ($res -and $res.Text) { Say ([string]::Format($inv, 'OK:{0:0.00}:{1}', $res.Confidence, $res.Text)) }
}
