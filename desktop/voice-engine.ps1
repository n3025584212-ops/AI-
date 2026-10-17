# One JSON request on stdin and one JSON result on stdout.
# No microphone input or audio playback device is selected.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$recognizer = $null
$synthesizer = $null
$stream = $null
$failureCode = 'native_error'
try {
    Add-Type -AssemblyName System.Speech
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $recognizerInfo = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
        Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
    $synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
    $voiceInfo = $synthesizer.GetInstalledVoices() |
        Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1

    switch ($request.operation) {
        'status' {
            # A registry token can exist even when process permissions prevent activation.
            $canRecognize = $false
            if ($null -ne $recognizerInfo) {
                try { $recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::new($recognizerInfo); $canRecognize = $true } catch {}
            }
            $data = @{ recognitionAvailable = $canRecognize; synthesisAvailable = ($null -ne $voiceInfo) }
        }
        'transcribe' {
            if ($null -eq $recognizerInfo) { $failureCode = 'unavailable'; throw 'missing-recognizer' }
            $failureCode = 'bad_request'
            $pcm = [Convert]::FromBase64String([string]$request.pcmBase64)
            if ($pcm.Length -eq 0 -or ($pcm.Length % 2) -ne 0) { throw 'invalid-pcm' }
            if ($pcm.Length -gt 800000) { $failureCode = 'too_long'; throw 'long-audio' }
            $failureCode = 'native_error'
            $recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::new($recognizerInfo)
            # Instance-only: do not adapt the user's acoustic profile from clips.
            try { $recognizer.UpdateRecognizerSetting('AdaptationOn', 0) } catch {}

            $dictation = [System.Speech.Recognition.DictationGrammar]::new()
            $dictation.Name = 'dictation'
            $recognizer.LoadGrammar($dictation)
            $phrases = [string[]]@(
                '切换到S5', '切换到第五机架', '查看第五机架', '放大S5', '放大第五机架',
                '显示整线', '显示全部机架', '显示五个机架', '切换透壳', '显示透壳', '透壳模式',
                '切换实体', '显示实体', '实体模式', '切换仅辊系', '仅辊系', '只看辊系',
                '俯视', '切换俯视', '操作侧', '切换操作侧', '传动侧', '切换传动侧', '透视', '切换透视',
                '暂停动画', '继续动画', '播放动画', '暂停数据', '播放数据', '继续数据',
                '全屏', '进入全屏', '退出全屏', '复位视角', '重置视角', '放大', '缩小',
                '展开辊系', '合拢辊系', '打开测点面板', '关闭测点面板',
                '打开全部参数', '关闭全部参数', '打开工况调整', '打开历史记录', '打开报告中心',
                'S5预测是多少', '第五机架预测是多少', '当前预测是多少', '预测结果是多少'
            )
            # Keep the exact phrases consumed by voiceCommands.js in a constrained
            # grammar. Unknown questions still use the unchanged dictation grammar.
            $phrases += [string[]]@(
                '打开维护设置', '查看维护设置', '进入维护设置',
                '打开运行日志', '查看运行日志', '打开系统日志', '打开日志',
                '打开异常事件', '查看异常事件', '打开事件页',
                '打开历史回放', '查看历史回放', '打开回放页面',
                '打开数据接入', '打开导入数据', '打开运行监测', '打开预测中心',
                'S5轧制力预测是多少', '当前S5预测是多少', '播报当前预测结果',
                '解释当前S5预测结果', '为什么只预测S5', '二十五维输入是什么',
                '当前模型有多少维输入', '当前模型是什么', '解释当前工况'
            )
            $chineseNumbers = [string[]]@('一', '二', '三', '四', '五')
            for ($standNumber = 1; $standNumber -le 5; $standNumber++) {
                $chinese = $chineseNumbers[$standNumber - 1]
                $standPhrases = [string[]]@("S$standNumber", "S${standNumber}机架", "${chinese}号机架", "第${chinese}机架", "第${chinese}号机架")
                foreach ($verb in [string[]]@('定位', '定位到', '切换到', '切到', '查看', '选择', '选中', '显示', '放大')) {
                    foreach ($standPhrase in $standPhrases) { $phrases += "$verb$standPhrase" }
                }
            }
            $phrases = [string[]]@($phrases | Select-Object -Unique)
            $choices = [System.Speech.Recognition.Choices]::new($phrases)
            $wakeChoices = [System.Speech.Recognition.Choices]::new([string[]]@(
                '小迪', '小DK', 'DK助手', '迪凯助手',
                '你好小迪', '你好小DK', '你好DK助手', '你好迪凯助手'
            ))
            # Negations are grammar alternatives in their own right, never stripped
            # or converted to a positive action. The JS command parser rejects them.
            $negativeChoices = [System.Speech.Recognition.Choices]::new([string[]]@(
                '不要', '别', '不许', '禁止', '不用', '无需', '不必', '不得'
            ))
            foreach ($useWake in @($false, $true)) {
                foreach ($negative in @($false, $true)) {
                    $builder = [System.Speech.Recognition.GrammarBuilder]::new()
                    $builder.Culture = $recognizerInfo.Culture
                    if ($useWake) { $builder.Append($wakeChoices) }
                    if ($negative) { $builder.Append($negativeChoices) }
                    $builder.Append($choices)
                    $grammar = [System.Speech.Recognition.Grammar]::new($builder)
                    $grammar.Name = 'workspace-commands-wake-' + $useWake + '-negative-' + $negative
                    $grammar.Priority = 1
                    $recognizer.LoadGrammar($grammar)
                }
            }
            $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5)
            $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(5)
            $recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(600)
            $recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1000)
            $stream = [System.IO.MemoryStream]::new($pcm, $false)
            $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
                16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
                [System.Speech.AudioFormat.AudioChannel]::Mono
            )
            $recognizer.SetInputToAudioStream($stream, $format)
            # SAPI releases a completed file input; use Multiple recognition
            # with native event handlers so pauses do not drop later sentences.
            Add-Type -ReferencedAssemblies 'System.Speech' -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Speech.Recognition;
using System.Threading;
public static class DKQKAROfflineRecognition {
    public static RecognitionResult[] ReadAll(SpeechRecognitionEngine engine) {
        var results = new List<RecognitionResult>();
        Exception failure = null;
        using (var finished = new ManualResetEvent(false)) {
            EventHandler<SpeechRecognizedEventArgs> recognized = (sender, args) => {
                lock (results) { results.Add(args.Result); }
            };
            EventHandler<RecognizeCompletedEventArgs> completed = (sender, args) => {
                failure = args.Error;
                finished.Set();
            };
            engine.SpeechRecognized += recognized;
            engine.RecognizeCompleted += completed;
            try {
                engine.RecognizeAsync(RecognizeMode.Multiple);
                if (!finished.WaitOne(24000)) {
                    engine.RecognizeAsyncCancel();
                    finished.WaitOne(500);
                    throw new TimeoutException("Recognition timed out.");
                }
                if (failure != null) throw failure;
                lock (results) { return results.ToArray(); }
            } finally {
                engine.SpeechRecognized -= recognized;
                engine.RecognizeCompleted -= completed;
            }
        }
    }
}
"@
            $results = [DKQKAROfflineRecognition]::ReadAll($recognizer)
            $parts = [System.Collections.Generic.List[string]]::new()
            $confidences = [System.Collections.Generic.List[double]]::new()
            foreach ($result in $results) {
                if (-not [string]::IsNullOrWhiteSpace($result.Text)) {
                    $parts.Add($result.Text)
                    $confidences.Add([double]$result.Confidence)
                }
            }
            if ($parts.Count -eq 0) { $failureCode = 'no_speech'; throw 'no-recognition' }
            $confidence = ($confidences | Measure-Object -Average).Average
            $data = @{ text = ($parts -join '，'); confidence = [Math]::Round($confidence, 4) }

        }
        'synthesize' {
            if ($null -eq $voiceInfo) { $failureCode = 'unavailable'; throw 'missing-voice' }
            $failureCode = 'bad_request'
            $speechText = [string]$request.text
            if ([string]::IsNullOrWhiteSpace($speechText) -or $speechText.Length -gt 120) { throw 'invalid-text' }
            $failureCode = 'native_error'
            $requestedVoice = [string]$request.voice
            $rate = 1
            if ($null -ne $request.rate) { try { $rate = [Math]::Max(-2, [Math]::Min(4, [int]$request.rate)) } catch {} }
            if ($requestedVoice -and $requestedVoice -ne 'default') {
                $matched = $synthesizer.GetInstalledVoices() |
                    Where-Object { $_.Enabled -and $_.VoiceInfo.Name -like ("*" + $requestedVoice + "*") } | Select-Object -First 1
                if ($matched) { $synthesizer.SelectVoice($matched.VoiceInfo.Name) }
            }
            $synthesizer.Rate = $rate
            $stream = [System.IO.MemoryStream]::new()
            $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
                16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
                [System.Speech.AudioFormat.AudioChannel]::Mono
            )
            $synthesizer.SetOutputToAudioStream($stream, $format)
            $synthesizer.Speak($speechText)
            $synthesizer.SetOutputToNull()
            $pcm = $stream.ToArray()
            if ($pcm.Length -gt 800000) { $failureCode = 'too_long'; throw 'long-audio' }
            $data = @{ pcmBase64 = [Convert]::ToBase64String($pcm) }
            $stream = [System.IO.MemoryStream]::new()
            $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
                16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
                [System.Speech.AudioFormat.AudioChannel]::Mono
            )
            $synthesizer.SetOutputToAudioStream($stream, $format)
            $synthesizer.Speak($speechText)
            $synthesizer.SetOutputToNull()
            $pcm = $stream.ToArray()
            if ($pcm.Length -gt 800000) { $failureCode = 'too_long'; throw 'long-audio' }
            $data = @{ pcmBase64 = [Convert]::ToBase64String($pcm) }
        }
        default { $failureCode = 'bad_request'; throw 'unsupported-operation' }
    }
    [Console]::Out.WriteLine((@{ ok = $true; data = $data } | ConvertTo-Json -Depth 5 -Compress))
}
catch {
    # Native error details can contain host paths; return only a fixed code.
    [Console]::Out.WriteLine((@{ ok = $false; code = $failureCode } | ConvertTo-Json -Compress))
    exit 1
}
finally {
    if ($null -ne $recognizer) { $recognizer.Dispose() }
    if ($null -ne $synthesizer) { $synthesizer.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
}
