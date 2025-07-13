// 全局变量
let focusChart;
let focusData = [];
let totalFocusTime = 0;
let totalSessionTime = 0;
let sessionStartTime = Date.now();

const ALERT_COOLDOWN = 3000;
const ABSENCE_THRESHOLD = 5000;
const ABSENCE_ALERT = 5 * 60 * 1000;
let lastAlertTime = 0;
let lastFaceTime = Date.now();
let absenceAlerted = false;
let hasDetectedFace = false;
let isFocus = false;

// 人脸检测状态缓冲
let faceDetectionBuffer = {
  consecutiveDetections: 0,
  consecutiveNonDetections: 0,
  lastStatus: null
};
const DETECTION_THRESHOLD = 2; // 连续检测到2次才确认
const NON_DETECTION_THRESHOLD = 3; // 连续未检测到3次才确认

// ====== 实时状态更新 ======
function updateFaceDetectionStatus(isDetected) {
  const statusElement = document.getElementById('faceDetectionStatus');
  const now = Date.now();
  
  // 更新检测缓冲
  if (isDetected) {
    faceDetectionBuffer.consecutiveDetections++;
    faceDetectionBuffer.consecutiveNonDetections = 0;
  } else {
    faceDetectionBuffer.consecutiveNonDetections++;
    faceDetectionBuffer.consecutiveDetections = 0;
  }
  
  // 确定最终状态
  let finalStatus;
  if (faceDetectionBuffer.consecutiveDetections >= DETECTION_THRESHOLD) {
    finalStatus = 'detected';
  } else if (faceDetectionBuffer.consecutiveNonDetections >= NON_DETECTION_THRESHOLD) {
    // 只有在5秒内未检测到人脸时才显示"未检测到"
    if (now - lastFaceTime > 5000) {
      finalStatus = 'not-detected';
    } else {
      finalStatus = 'detecting';
    }
  } else {
    // 缓冲期间保持之前的状态或显示检测中
    finalStatus = faceDetectionBuffer.lastStatus || 'detecting';
  }
  
  // 更新显示
  switch (finalStatus) {
    case 'detected':
      statusElement.textContent = '✅ 已检测到';
      statusElement.className = 'status-value detected';
      break;
    case 'not-detected':
      statusElement.textContent = '❌ 未检测到';
      statusElement.className = 'status-value not-detected';
      break;
    case 'detecting':
    default:
      statusElement.textContent = '⏳ 检测中...';
      statusElement.className = 'status-value detecting';
      break;
  }
  
  // 保存当前状态
  faceDetectionBuffer.lastStatus = finalStatus;
}

function updateFocusSiteStatus(isFocus) {
  const statusElement = document.getElementById('focusSiteStatus');
  if (isFocus) {
    statusElement.textContent = '✅ 专注网页';
    statusElement.className = 'status-value detected';
  } else {
    statusElement.textContent = '❌ 非专注网页';
    statusElement.className = 'status-value not-detected';
  }
}

// ====== 数据存取 ======
function loadFocusData() {
  const saved = localStorage.getItem('focusData');
  if (saved) focusData = JSON.parse(saved);
  const stats = JSON.parse(localStorage.getItem('focusStats') || '{}');
  totalFocusTime = stats.totalFocusTime || 0;
  totalSessionTime = stats.totalSessionTime || 0;
}
function saveFocusData() {
  localStorage.setItem('focusData', JSON.stringify(focusData));
  localStorage.setItem('focusStats', JSON.stringify({
    totalFocusTime,
    totalSessionTime
  }));
}

// ====== 专注网址 ======
function getFocusSites() {
  const v = localStorage.getItem('focusSites');
  return v ? v.split(',').map(s=>s.trim()).filter(Boolean) : [];
}
function saveFocusSites() {
  const val = document.getElementById('focusSitesInput').value;
  const newSites = val.split(',').map(s => s.trim()).filter(Boolean);
  const oldSites = getFocusSites();
  // 合并并去重
  const merged = Array.from(new Set([...oldSites, ...newSites]));
  localStorage.setItem('focusSites', merged.join(','));
  document.getElementById('focusSitesInput').value = '';
  updateFocusSitesDisplay();
}

function updateFocusSitesDisplay() {
  const sites = getFocusSites();
  const container = document.getElementById('currentFocusSitesList');
  if (!container) return;
  if (sites.length === 0) {
    container.innerHTML = '<span class="no-sites">暂无专注网址（浏览专注网址时会自动记录专注时长）</span>';
  } else {
    container.innerHTML = sites.map((site, idx) =>
      `<div class="focus-site-row">
        <span class="site-url">${site}</span>
        <button class="remove-site-btn" title="删除" data-idx="${idx}">-</button>
      </div>`
    ).join('');
    // 绑定删除事件
    Array.from(container.getElementsByClassName('remove-site-btn')).forEach(btn => {
      btn.onclick = function() {
        const idx = parseInt(this.getAttribute('data-idx'));
        const newSites = getFocusSites();
        newSites.splice(idx, 1);
        localStorage.setItem('focusSites', newSites.join(','));
        updateFocusSitesDisplay();
      };
    });
  }
}

function checkFocusSiteStatus(callback) {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const tabUrl = tabs[0].url;
    const sites = getFocusSites();
    let isFocus = false;
    if (sites.length === 0) {
      isFocus = true;
    } else {
      isFocus = sites.some(site => tabUrl.startsWith(site));
    }
    updateFocusSiteStatus(isFocus);
    if (callback) callback(isFocus);
  });
}
// function isOnFocusSite() {
//   const sites = getFocusSites();
//   if (sites.length === 0) return true;
//   return sites.some(site => location.href.startsWith(site));
// }

// ====== Chart.js 初始化与更新 ======
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
            stepSize: 10,
            displayFormats: {
              minute: 'HH:mm',
              hour: 'HH:mm'
            }
          },
          ticks: {
            autoSkip: false,
            source: 'auto',
            maxTicksLimit: 12,
            callback: function(value) {
              const date = new Date(value);
              const minutes = date.getMinutes();
              // 只显示每10分钟的刻度
              if (minutes % 10 === 0) {
                return date.getHours().toString().padStart(2, '0') + ':' +
                       date.getMinutes().toString().padStart(2, '0');
              }
              return '';
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
  const hours = +document.getElementById('timeRange').value;
  const cutoff = Date.now() - hours*3600*1000;
  const pts = focusData.filter(p=>p.timestamp>=cutoff);
  focusChart.data.labels = pts.map(p=>new Date(p.timestamp));
  focusChart.data.datasets[0].data = pts.map(p=>p.focusRate);
  focusChart.update();
}

// ====== 统计面板 ======
function updateStats() {
  const rate = totalSessionTime>0?Math.round(totalFocusTime/totalSessionTime*100):0;
  document.getElementById('focusRate').textContent = rate + '%';
  document.getElementById('totalTime').textContent = Math.round(totalSessionTime/60) + '分钟';
  document.getElementById('focusTime').textContent = Math.round(totalFocusTime/60) + '分钟';
}

// ====== 数据导出/清除 ======
function exportData() {
  const blob = new Blob([JSON.stringify(focusData,0,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focus-data-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function clearData() {
  if (!confirm('确定要清除所有专注数据吗？')) return;
  focusData = []; totalFocusTime = 0; totalSessionTime = 0; sessionStartTime = Date.now();
  updateStats(); updateChart(); saveFocusData();
}

// ====== 添加数据点 ======
function addFocusDataPoint(isFocused) {
  const now = Date.now();
  focusData.push({ timestamp: now, focusRate: isFocused?100:0 });
  // 保留一天内
  const oneDayAgo = now - 24*3600*1000;
  focusData = focusData.filter(p=>p.timestamp>=oneDayAgo);
  totalSessionTime++;
  if (isFocused) totalFocusTime++;
  updateStats(); updateChart(); saveFocusData();
}

// ====== 摄像头 & 人脸识别 ======
async function setupFace() {
  document.getElementById('status').textContent = '⌛ 模型加载中…';
  await faceapi.nets.tinyFaceDetector.loadFromUri('weights');
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri('weights');
  document.getElementById('status').textContent = '📹 摄像头启动中…';
  const stream = await navigator.mediaDevices.getUserMedia({video:true});
  document.getElementById('video').srcObject = stream;
  document.getElementById('status').textContent = '✅ 运行中';
  runDetectionLoop();
}

function runDetectionLoop() {
  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const ctx = overlay.getContext('2d');
  const centerX = overlay.width/2, centerY = overlay.height/2;
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize:416, scoreThreshold:0.1 });

  setInterval(async ()=>{
    const det = await faceapi.detectSingleFace(video, options).withFaceLandmarks(true);
    ctx.clearRect(0,0,overlay.width, overlay.height);
    // 画中线
    ctx.setLineDash([5,5]);
    ctx.strokeStyle='rgba(0,255,0,0.5)';
    ctx.beginPath(); ctx.moveTo(centerX,0); ctx.lineTo(centerX,overlay.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,centerY); ctx.lineTo(overlay.width,centerY); ctx.stroke();
    ctx.setLineDash([]);

    // 更新人脸检测状态
    const isFaceDetected = !!det;
    updateFaceDetectionStatus(isFaceDetected);
    
    // 更新专注网页状态
    checkFocusSiteStatus(function(isFocus) {
      // 只有人脸检测到且在专注网页，才算专注
      const isFocused = isFaceDetected && isFocus;
      addFocusDataPoint(isFocused);

      // 5分钟未检测到人脸提醒逻辑也放到这里
      if (!isFocused && Date.now()-lastFaceTime > ABSENCE_ALERT && !absenceAlerted) {
        alert('超过5分钟未检测到人脸，请回到屏幕前！');
        absenceAlerted = true;
      }
    });

    if (det) {
      const box = det.detection.box;
      ctx.strokeStyle='green'; ctx.lineWidth=2;
      ctx.strokeRect(box.x,box.y,box.width,box.height);
      lastFaceTime = Date.now();
      absenceAlerted = false;
      hasDetectedFace = true;
    }

    // const isFocused = hasDetectedFace
    //   ? (Date.now()-lastFaceTime <= ABSENCE_THRESHOLD) && isOnFocusSite()
    //   : true;

    // addFocusDataPoint(isFocused);

    // if (!isFocused && Date.now()-lastFaceTime > ABSENCE_ALERT && !absenceAlerted) {
    //   alert('超过5分钟未检测到人脸，请回到屏幕前！');
    //   absenceAlerted = true;
    // }
  }, 1000);
}

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', ()=>{
  // 绑定 UI
  document.getElementById('saveSitesBtn').addEventListener('click', saveFocusSites);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('clearBtn').addEventListener('click', clearData);
  document.getElementById('timeRange').addEventListener('change', updateChart);

  document.getElementById('focusSitesInput').value = localStorage.getItem('focusSites') || '';

  // 更新专注网址显示
  updateFocusSitesDisplay();

  // 加载数据 & 初始图表
  loadFocusData();
  if (!focusData.length) {
    // 首次给一些默认点
    const now = Date.now();
    for (let i=10; i>=1; i--) {
      focusData.push({ timestamp: now - i*1000, focusRate:100 });
      totalSessionTime++; totalFocusTime++;
    }
    saveFocusData();
  }

  initChart();
  updateChart();
  updateStats();
  
  // 初始化状态显示
  const statusElement = document.getElementById('faceDetectionStatus');
  statusElement.textContent = '⏳ 检测中...';
  statusElement.className = 'status-value detecting';
  checkFocusSiteStatus();
  
  setupFace();
});
