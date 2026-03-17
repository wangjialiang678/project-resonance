const app = getApp();
let recorderManager = null;

// API backend URL — TODO: add /stepfun-asr route to Workers API
const API_BASE = 'https://project-resonance-api.project-resonance.workers.dev';

Page({
  data: {
    state: 'idle', // idle | recording | processing | result | error
    duration: 0,
    formatDuration: '0:00',
    transcript: '',
    statusText: '',
    errorMsg: '',
    voiceCloned: false,
  },

  onLoad() {
    this.setData({
      voiceCloned: !!app.globalData.voiceCloned,
    });
    this._initRecorder();
  },

  onUnload() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }

    if (this.data.state === 'recording' && recorderManager) {
      recorderManager.stop();
    }
  },

  _initRecorder() {
    try {
      if (!wx.getRecorderManager) {
        throw new Error('RecorderManager API 不可用');
      }

      recorderManager = wx.getRecorderManager();
      this._setupRecorder();
    } catch (error) {
      console.error('[Record] init recorder failed:', error);
      this.setData({
        state: 'error',
        errorMsg: '当前环境暂不支持录音，请在真机微信中重试',
      });
    }
  },

  _setupRecorder() {
    if (!recorderManager) return;

    recorderManager.onStart(() => {
      console.log('[Record] Started');
      this._startTime = Date.now();
      this._timer = setInterval(() => {
        const duration = Math.floor((Date.now() - this._startTime) / 1000);
        const mins = Math.floor(duration / 60);
        const secs = duration % 60;
        this.setData({
          duration,
          formatDuration: `${mins}:${secs.toString().padStart(2, '0')}`,
        });
      }, 200);
    });

    recorderManager.onStop((res) => {
      console.log('[Record] Stopped, tempFilePath:', res.tempFilePath);
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }

      const finalDuration = (Date.now() - this._startTime) / 1000;
      if (finalDuration < 0.5) {
        this.setData({ state: 'idle' });
        wx.showToast({ title: '录音时间太短', icon: 'none' });
        return;
      }

      this._tempFilePath = res.tempFilePath;
      this._recordDuration = finalDuration;
      this._processRecording(res.tempFilePath);
    });

    recorderManager.onError((err) => {
      console.error('[Record] Error:', err);
      if (this._timer) clearInterval(this._timer);
      this.setData({
        state: 'error',
        errorMsg: '录音失败: ' + (err.errMsg || '未知错误'),
      });
    });
  },

  startRecord() {
    if (!recorderManager) {
      this.setData({
        state: 'error',
        errorMsg: '录音组件初始化失败，请重试',
      });
      return;
    }

    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this.setData({ state: 'recording', duration: 0, formatDuration: '0:00' });
        recorderManager.start({
          duration: 120000, // max 2 minutes
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: 'mp3',
        });
      },
      fail: () => {
        wx.showModal({
          title: '需要录音权限',
          content: '请在设置中允许录音权限',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting();
          },
        });
      },
    });
  },

  stopRecord() {
    if (!recorderManager) return;
    recorderManager.stop();
  },

  _processRecording(filePath, retryCount) {
    retryCount = retryCount || 0;
    this.setData({ state: 'processing', statusText: retryCount > 0 ? `正在重试识别 (${retryCount}/2)...` : '正在识别语音...' });

    console.log('[ASR] Uploading to:', `${API_BASE}/stepfun-asr`);

    wx.uploadFile({
      url: `${API_BASE}/stepfun-asr`,
      filePath: filePath,
      name: 'file',
      formData: { model: 'step-asr' },
      success: (res) => {
        console.log('[ASR] statusCode:', res.statusCode, 'data:', res.data);
        try {
          const data = JSON.parse(res.data);

          if (data.error) {
            const status = data.status || res.statusCode;
            if ((status === 503 || status === 502) && retryCount < 2) {
              console.log('[ASR] Service unavailable, retrying in 2s...');
              setTimeout(() => this._processRecording(filePath, retryCount + 1), 2000);
              return;
            }
            this.setData({
              state: 'error',
              errorMsg: `识别服务错误 (${status}): ${data.error}`,
            });
            return;
          }

          const text = (data.text || '').trim();
          if (text) {
            this.setData({ state: 'result', transcript: text });
          } else {
            this.setData({ state: 'result', transcript: '（未识别到语音内容）' });
          }
        } catch (e) {
          console.error('[ASR] Parse error:', e, 'raw:', res.data);
          this.setData({
            state: 'error',
            errorMsg: '识别结果解析失败: ' + (res.data || '').slice(0, 100),
          });
        }
      },
      fail: (err) => {
        console.error('[ASR] Upload error:', JSON.stringify(err));
        let msg = '网络请求失败';
        if (err.errMsg && err.errMsg.includes('url not in domain list')) {
          msg = '域名未加入白名单。请在微信开发者工具中勾选「不校验合法域名」';
        } else if (err.errMsg) {
          msg = err.errMsg;
        }
        this.setData({
          state: 'error',
          errorMsg: msg,
        });
      },
    });
  },

  confirmResult() {
    const { transcript } = this.data;
    // Store result in globalData for WebView to pick up
    app.globalData.lastTranscript = transcript;
    app.globalData.lastRecordFilePath = this._tempFilePath || '';
    app.globalData.lastRecordDuration = this._recordDuration || 0;
    app.globalData.hasNewTranscript = true;

    wx.navigateBack();
  },

  retryRecord() {
    this.setData({
      state: 'idle',
      duration: 0,
      formatDuration: '0:00',
      transcript: '',
      errorMsg: '',
    });
  },

  goBack() {
    wx.navigateBack();
  },
});
