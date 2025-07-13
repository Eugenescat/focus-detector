// Chart.js, face-api.js, and chartjs-adapter-date-fns are loaded via <script> in popup.html

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusDiv = document.getElementById('status');
const ctx = overlay.getContext('2d');

let lastAlertTime = 0;
const ALERT_COOLDOWN = 3000; // 3秒内不重复提醒
let lastFaceTime = Date.now();
const ABSENCE_THRESHOLD = 5000; // 5秒
const ABSENCE_ALERT = 5 * 60 * 1000; // 5分钟
let absenceAlerted = false;
let hasDetectedFace = false;

// 专注数据相关变量
let focusData = [];
let sessionStartTime = Date.now();
let totalFocusTime = 0;
let totalSessionTime = 0;
let focusChart;

// ========== 专注网址设置 ==========
// function getFocusSites() {
//   const sites = localStorage.getItem('focusSites');
//   if (!sites) return [];
//   return sites.split(',').map(s => s.trim()).filter(Boolean);
// }
// function saveFocusSites() {
//   const val = document.getElementById('focusSitesInput').value;
//   localStorage.setItem('focusSites', val);
//   alert('专注网址已保存！');
// }
// window.addEventListener('DOMContentLoaded', () => {
//   const val = localStorage.getItem('focusSites') || '';
//   const input = document.getElementById('focusSitesInput');
//   if (input) input.value = val;
// });
// function isOnFocusSite() {
//   const sites = getFocusSites();
//   return sites.some(site => window.location.href.startsWith(site));
// }

// ========== 数据存取 ==========
function loadFocusData() {
  const saved = localStorage.getItem('focusData');
  if (saved) {
    focusData = JSON.parse(saved);
  }
  const savedStats = localStorage.getItem('focusStats');
  if (savedStats) {
    const stats = JSON.parse(savedStats);
    totalFocusTime = stats.totalFocusTime || 0;
    totalSessionTime = stats.totalSessionTime || 0;
  }
}
function saveFocusData() {
  localStorage.setItem('focusData', JSON.stringify(focusData));
  localStorage.setItem('focusStats', JSON.stringify({
    totalFocusTime,
    totalSessionTime
  }));
}

// ========== 图表 ==========
function initChart() {
  const chartCtx = document.getElementById('focusChart').getContext('2d');
  focusChart = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: '专注度',
        data: [],
        borderColor: '#2ecc71',
        backgroundColor: 'rgba(46, 204, 113, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              if (value === 0 || value === 100) {
                return value + '%';
              }
              return '';
            },
            stepSize: 100,
            min: 0,
            max: 100
          }
        },
        x: {
          type: 'time',
          time: {
            unit: 'minute',
            displayFormats: {
              minute: 'HH:mm',
              hour: 'HH:mm'
            }
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 5,
            callback: function(value) {
              const date = new Date(value);
              return date.getHours().toString().padStart(2, '0') + ':' +
                     date.getMinutes().toString().padStart(2, '0');
            }
          },
          title: {
            display: true,
            text: '时间'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: '专注度历史曲线'
        },
        legend: {
          display: true
        }
      }
    }
  });
}
function updateChart() {
  if (!focusChart) return;
  const timeRange = parseInt(document.getElementById('timeRange').value);
  const now = Date.now();
  const cutoffTime = now - (timeRange * 60 * 60 * 1000);
  const filteredData = focusData.filter(point => point.timestamp >= cutoffTime);
  focusChart.data.labels = filteredData.map(point => new Date(point.timestamp));
  focusChart.data.datasets[0].data = filteredData.map(point => point.focusRate);
  focusChart.update();
}

// ========== 统计 ==========
function updateStats() {
  const focusRate = totalSessionTime > 0 ? Math.round((totalFocusTime / totalSessionTime) * 100) : 0;
  const totalMinutes = Math.round(totalSessionTime / 60);
  const focusMinutes = Math.round(totalFocusTime / 60);
  document.getElementById('focusRate').textContent = focusRate + '%';
  document.getElementById('totalTime').textContent = totalMinutes + '分钟';
  document.getElementById('focusTime').textContent = focusMinutes + '分钟';
}

// ========== 导出/清除 ==========
function exportData() {
  const dataStr = JSON.stringify(focusData, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'focus-data-' + new Date().toISOString().split('T')[0] + '.json';
  link.click();
  URL.revokeObjectURL(url);
}
function clearData() {
  if (confirm('确定要清除所有专注数据吗？')) {
    focusData = [];
    totalFocusTime = 0;
    totalSessionTime = 0;
    sessionStartTime = Date.now();
    updateStats();
    updateChart();
    saveFocusData();
  }
}

// ========== 专注数据点采集 ==========
function addFocusDataPoint(isFocused) {
  const now = Date.now();
  const sessionDuration = (now - sessionStartTime) / 1000;
  const focusRate = isFocused ? 100 : 0;
  focusData.push({
    timestamp: now,
    focusRate: focusRate,
    sessionDuration: sessionDuration
  });
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  focusData = focusData.filter(point => point.timestamp >= oneDayAgo);
  if (isFocused) {
    totalFocusTime += 1;
  }
  totalSessionTime += 1;
  updateStats();
  updateChart();
  saveFocusData();
}

// ========== 摄像头与检测 ==========
async function setup() {
  updateStatus('⌛ 模型加载中…', 'loading');
  await faceapi.nets.tinyFaceDetector.loadFromUri('weights');
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri('weights');
  updateStatus('✅ 模型加载完成，正在启动摄像头…', 'ready');
  await startVideo();
  updateStatus('📹 摄像头已启动', 'ready');
}
async function startVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
    video.srcObject = stream;
  } catch (err) {
    console.error(err);
    if (err.name === 'NotAllowedError') {
      updateStatus('❌ 摄像头权限被拒绝，请在浏览器地址栏或系统设置中允许访问摄像头', 'error');
    } else {
      updateStatus(`❌ 无法启动摄像头：${err.message}`, 'error');
    }
  }
}
function updateStatus(message, className) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${className}`;
}
function showAlert(message) {
  const now = Date.now();
  if (now - lastAlertTime > ALERT_COOLDOWN) {
    alert(message);
    lastAlertTime = now;
  }
}

// ========== 主流程 ==========
video.addEventListener('play', () => {
  const centerX = overlay.width / 2;
  const centerY = overlay.height / 2;
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.3
  });
  function drawCenterLines() {
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, overlay.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(overlay.width, centerY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  setInterval(async () => {
    const detection = await faceapi
      .detectSingleFace(video, options)
      .withFaceLandmarks(true);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawCenterLines();
    if (detection) {
      const nose = detection.landmarks.getNose()[0];
      const leftEye = detection.landmarks.getLeftEye()[0];
      const rightEye = detection.landmarks.getRightEye()[0];
      ctx.strokeStyle = 'green';
      ctx.lineWidth = 3;
      ctx.strokeRect(detection.detection.box.x, detection.detection.box.y, 
                    detection.detection.box.width, detection.detection.box.height);
      ctx.fillStyle = 'yellow';
      ctx.beginPath();
      ctx.arc(nose.x, nose.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'blue';
      ctx.beginPath();
      ctx.arc(leftEye.x, leftEye.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(rightEye.x, rightEye.y, 3, 0, Math.PI * 2);
      ctx.fill();
      lastFaceTime = Date.now();
      absenceAlerted = false;
      hasDetectedFace = true;
    }
    // 只有在专注网址且5秒内检测到人脸才算专注
    let isCurrentlyFocused;
    if (!hasDetectedFace) {
      isCurrentlyFocused = true; // 首次检测到人脸前，强制为100
    } else {
      isCurrentlyFocused = (Date.now() - lastFaceTime <= ABSENCE_THRESHOLD); // && isOnFocusSite();
    }
    addFocusDataPoint(isCurrentlyFocused);
    if (isCurrentlyFocused) {
      updateStatus('🟢 正对屏幕', 'focused');
    } else {
      updateStatus('⚠️ 未检测到人脸', 'no-face');
    }
    if (!absenceAlerted && Date.now() - lastFaceTime > ABSENCE_ALERT) {
      alert('超过5分钟未检测到人脸，请回到屏幕前！');
      absenceAlerted = true;
    }
  }, 1000);
});

// ========== 初始化 ==========
loadFocusData();
// 如果focusData为空，补充一段100的点，保证初始曲线为100
if (focusData.length === 0) {
  const now = Date.now();
  for (let i = 0; i < 10; i++) {
    focusData.push({
      timestamp: now - (10 - i) * 1000,
      focusRate: 100,
      sessionDuration: i + 1
    });
  }
  saveFocusData();
}
initChart();
updateChart();
updateStats();
setup(); 