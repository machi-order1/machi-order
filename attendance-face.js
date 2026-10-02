/* Face-assisted name selection. PIN remains required for all punches. */
(() => {
  const MODEL = 'face-api-0.22.2-recognition-v1';
  let api, identify, credentials, stream, generation = 0, attempt = null, loading;
  const el = id => document.getElementById(id);
  const say = text => { el('face-message').textContent = text; };
  function stop() {
    generation++;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    el('face-video').srcObject = null;
    el('face-video').hidden = true;
    el('face-start').disabled = false;
    el('face-enroll').disabled = false;
  }
  function deadline(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), ms);
    })]).finally(() => clearTimeout(timer));
  }
  function models() {
    if (!loading) loading = (async () => {
      if (!window.faceapi) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/vendor/face-api/face-api.min.js';
        script.onload = resolve; script.onerror = reject;
        document.head.appendChild(script);
      });
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/vendor/face-api/models'),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('/vendor/face-api/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/vendor/face-api/models'),
      ]);
    })().catch(error => { loading = null; throw error; });
    return loading;
  }
  async function camera(g) {
    if (!navigator.mediaDevices?.getUserMedia) throw Error('camera_unavailable');
    const requested = navigator.mediaDevices.getUserMedia({ audio: false, video: {
      facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 },
    }}).then(value => {
      if (g !== generation) { value.getTracks().forEach(t => t.stop()); throw Error('cancelled'); }
      stream = value;
      return value;
    });
    await deadline(requested, 10000, 'camera_unavailable');
    const video = el('face-video');
    video.srcObject = stream; video.hidden = false;
    await deadline(video.play(), 3000, 'camera_unavailable');
  }
  async function sample(g) {
    const until = Date.now() + 3000;
    while (g === generation && Date.now() < until) {
      const result = await deadline(faceapi.detectAllFaces(el('face-video'),
        new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.6 }))
        .withFaceLandmarks(true).withFaceDescriptors(), Math.max(1, until - Date.now()), 'timeout');
      if (g !== generation) throw Error('cancelled');
      if (result.length > 1) throw Error('multiple_faces');
      if (result.length === 1) return Array.from(result[0].descriptor);
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw Error('timeout');
  }
  async function fallback(reason = 'manual') {
    const id = attempt;
    stop();
    say('顔を確認できなくても打刻できます。名前を選び、PINを入力してください。');
    if (id) api('POST', { action: 'face_fallback', attempt_id: id, reason }).catch(() => {
      say('名前とPINで打刻してください。顔確認の履歴は通信状況により未保存です。');
    });
  }
  async function start() {
    stop(); attempt = null;
    const g = generation;
    el('face-start').disabled = true;
    say('準備しています。待たずに下の名前・PINでも打刻できます。');
    try {
      const begun = await api('POST', { action: 'face_begin' });
      if (g !== generation) return;
      attempt = begun.attempt_id;
      await deadline(models(), 12000, 'model_unavailable');
      if (g !== generation) return;
      await camera(g);
      if (g !== generation) return;
      say('正面を向いてください。顔の確認は約3秒で切り替わります。');
      const descriptor = await sample(g);
      const result = await api('POST', { action: 'face_identify', attempt_id: attempt, model: MODEL, descriptor });
      if (g !== generation) return;
      stop();
      if (result.person) {
        say('名前を確認できました。PINを入力して打刻してください。');
        identify(result.person, attempt);
      } else say('名前を確認できませんでした。下から選んでPINで打刻してください。');
    } catch (error) {
      if (g !== generation) return;
      await fallback(['timeout','multiple_faces','model_unavailable'].includes(error.message) ? error.message : 'camera_unavailable');
    }
  }
  async function enroll() {
    if (!el('face-consent').checked) {
      say('登録内容を確認し、同意にチェックしてください。PINだけでも利用できます。'); return;
    }
    const auth = credentials();
    if (!auth) return;
    stop(); const g = generation;
    el('face-panel').hidden = false;
    el('face-panel').classList.remove('hide');
    el('face-enroll').disabled = true;
    say('顔登録を準備しています。');
    try {
      await deadline(models(), 12000, 'model_unavailable');
      if (g !== generation) return;
      await camera(g);
      const descriptors = [];
      for (let i = 0; i < 3; i++) {
        if (g !== generation) return;
        say(`正面を向いてください。顔登録 ${i + 1}/3`);
        descriptors.push(await sample(g));
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (g !== generation) return;
      await api('POST', { action: 'face_enroll', ...auth, consent: true, model: MODEL, descriptors });
      if (g !== generation) return;
      stop(); say('顔の特徴データを登録しました。顔写真は保存していません。');
    } catch (error) {
      if (g !== generation) return;
      stop(); say('登録できませんでした。PIN打刻はそのまま使えます。' + (error.status ? error.message : 'カメラ・明るさ・通信を確認してください。'));
    }
  }
  window.MachiFace = {
    init(options) {
      ({ api, identify, credentials } = options);
      el('face-start').onclick = start;
      el('face-cancel').onclick = () => fallback();
      el('face-enroll').onclick = enroll;
      el('face-delete').onclick = async () => {
        const auth = credentials(); if (!auth) return;
        stop();
        try { await api('POST', { action: 'face_delete', ...auth }); say('顔の登録を削除しました。PINで打刻できます。'); }
        catch (error) { say('削除できませんでした。' + error.message); }
      };
      document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
      window.addEventListener('pagehide', stop);
    },
    reset() { stop(); attempt = null; el('face-consent').checked = false; },
    choose() { stop(); },
    attemptId() { return attempt; },
  };
})();
