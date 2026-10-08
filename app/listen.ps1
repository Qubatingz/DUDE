# Push-to-talk: listens once with Windows speech recognition and prints what you said.
# Nothing is recorded or sent anywhere; it runs only when you press the mic button.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
try { Add-Type -AssemblyName System.Speech } catch { Write-Output 'ERR:norecognizer'; exit }
try {
  $all = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $info = $all | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq 'en' } | Select-Object -First 1
  if (-not $info) { $info = $all | Select-Object -First 1 }
  if (-not $info) { Write-Output 'ERR:norecognizer'; exit }
  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
} catch { Write-Output 'ERR:norecognizer'; exit }
try { $r.SetInputToDefaultAudioDevice() } catch { Write-Output 'ERR:nomic'; exit }
$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(7)
$r.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(900)
$r.BabbleTimeout = [TimeSpan]::FromSeconds(10)
try { $res = $r.Recognize([TimeSpan]::FromSeconds(15)) } catch { Write-Output 'ERR:nomic'; exit }
if ($res -and $res.Text) { Write-Output ('OK:' + $res.Text) } else { Write-Output 'ERR:nothing' }
