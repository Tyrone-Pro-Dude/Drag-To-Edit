// ═══════════════════════════════════════════════════════════
//  FLUXEDIT CONTENT SCRIPT — Pro Tools Edition
// ═══════════════════════════════════════════════════════════

(function () {
  if (document.getElementById('flux-root')) return;

  // --- State Architecture ---
  let activeImg = new Image();
  let historyStack = []; // Stores dataURLs for easy revert/undo
  let currentTool = null; // 'crop' or 'blur'
  
  // Crop Tool State
  let cropBox = { x: 50, y: 50, w: 150, h: 150 };
  let activeHandle = null; // 'tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r', 'move'
  let dragStart = { x: 0, y: 0 };
  let cropStartBox = { x: 0, y: 0, w: 0, h: 0 };

  // Blur Tool State
  let isDrawingBlur = false;
  let blurRadius = 15;
  let blurIntensity = 10;

  // ══════════════════════════════════════════════════════
  //  1. INJECT UI CORE & ELEMENTS
  // ══════════════════════════════════════════════════════
  const root = document.createElement('div');
  root.id = 'flux-root';
  document.body.appendChild(root);

  const style = document.createElement('style');
  style.textContent = `
    #flux-hotzone {
      position: fixed; top: 0; right: 0; width: 140px; height: 140px;
      background: rgba(0, 120, 255, 0.15); border-left: 2.5px dashed #007bff; border-bottom: 2.5px dashed #007bff;
      border-radius: 0 0 0 16px; display: flex; align-items: center; justify-content: center;
      z-index: 2147483647; opacity: 0; pointer-events: none; transition: opacity 0.2s;
      color: #007bff; font-family: system-ui, sans-serif; font-weight: bold; font-size: 13px;
    }
    #flux-hotzone.visible { opacity: 1; pointer-events: auto; }
    #flux-hotzone.active { background: rgba(0, 120, 255, 0.3); }

    #flux-panel {
      position: fixed; top: 20px; right: 20px; width: 420px;
      background: #1e1e2e; border: 1px solid #313244; border-radius: 16px;
      display: none; flex-direction: column; z-index: 2147483646;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5); padding: 16px;
      color: #cdd6f4; font-family: system-ui, sans-serif;
    }
    #flux-titlebar { cursor: move; font-weight: bold; padding-bottom: 10px; border-bottom: 1px solid #313244; margin-bottom: 12px; display: flex; justify-content: space-between; }
    
    .canvas-wrapper { position: relative; width: 100%; background: #11111b; border-radius: 8px; overflow: hidden; margin-bottom: 12px; display: flex; justify-content: center; align-items: center; }
    #editor-canvas { max-width: 100%; height: auto; display: block; }
    
    /* 8-Point Bounding Box Styles */
    #crop-overlay {
      position: absolute; border: 2px dashed #007bff; display: none;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5); cursor: move;
    }
    .crop-handle {
      position: absolute; width: 8px; height: 8px; background: #ffffff;
      border: 2px solid #007bff; border-radius: 2px; transform: translate(-50%, -50%);
    }

    /* Blur Brush Indicator Cursor */
    #blur-cursor-follower {
      position: fixed; width: 30px; height: 30px; border: 2px solid #007bff;
      border-radius: 50%; pointer-events: none; display: none; z-index: 2147483647;
      transform: translate(-50%, -50%); background: rgba(0, 123, 255, 0.1);
    }

    .flux-btn-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
    .flux-btn {
      padding: 10px; background: #313244; color: #cdd6f4; border: none;
      border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 12px; transition: background 0.15s;
    }
    .flux-btn:hover { background: #45475a; }
    .flux-btn.active-tool { background: #007bff; color: white; }
    .flux-btn.action-btn { background: #a6e3a1; color: #11111b; }
    .flux-btn.action-btn:hover { background: #94e2d5; }
    .flux-btn.danger-btn { background: #f38ba8; color: #11111b; }
    
    .control-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #181825; padding: 8px; border-radius: 8px; margin-bottom: 12px; font-size: 11px; }
    .control-row input { flex: 1; accent-color: #007bff; }
  `;
  document.head.appendChild(style);

  // 2. Inject Elements Into DOM Tree
  const hotzone = document.createElement('div');
  hotzone.id = 'flux-hotzone';
  hotzone.innerText = 'DROP HERE TO EDIT';
  root.appendChild(hotzone);

  const panel = document.createElement('div');
  panel.id = 'flux-panel';
  panel.innerHTML = `
    <div id="flux-titlebar"><span>FluxEdit Workspace</span><span id="flux-status" style="font-size:11px; color:#a6adc8;">Ready</span></div>
    <div class="canvas-wrapper">
      <canvas id="editor-canvas"></canvas>
      <div id="crop-overlay">
        <div class="crop-handle" style="top:0%; left:0%; cursor:nwse-resize;" data-handle="tl"></div>
        <div class="crop-handle" style="top:0%; left:100%; cursor:nesw-resize;" data-handle="tr"></div>
        <div class="crop-handle" style="top:100%; left:0%; cursor:nesw-resize;" data-handle="bl"></div>
        <div class="crop-handle" style="top:100%; left:100%; cursor:nwse-resize;" data-handle="br"></div>
        <div class="crop-handle" style="top:0%; left:50%; cursor:ns-resize;" data-handle="t"></div>
        <div class="crop-handle" style="top:100%; left:50%; cursor:ns-resize;" data-handle="b"></div>
        <div class="crop-handle" style="top:50%; left:0%; cursor:ew-resize;" data-handle="l"></div>
        <div class="crop-handle" style="top:50%; left:100%; cursor:ew-resize;" data-handle="r"></div>
      </div>
    </div>
    <div class="control-row" id="blur-controls" style="display:none;">
      <span>Intensity</span>
      <input type="range" id="blur-intensity-slider" min="2" max="30" value="10">
      <span>Brush Size</span>
      <input type="range" id="blur-size-slider" min="10" max="60" value="30">
    </div>
    <div class="flux-btn-grid">
      <button class="flux-btn" id="tool-crop">Crop Zone</button>
      <button class="flux-btn" id="tool-blur">Blur Brush</button>
      <button class="flux-btn" id="action-resize">Resize 50%</button>
    </div>
    <div class="flux-btn-grid">
      <button class="flux-btn danger-btn" id="action-revert">Revert Changes</button>
      <button class="flux-btn action-btn" id="action-trigger-crop" style="grid-column: span 2;">Apply Crop Cut ✂️</button>
    </div>
    <div class="flux-btn-grid">
      <button class="flux-btn action-btn" id="action-copy" style="grid-column: span 3; font-weight: bold;">Copy Final PNG 📋</button>
    </div>
    <button class="flux-btn danger-btn" id="action-close" style="width:100%; margin-top: 4px;">Close Workbench</button>
  `;
  root.appendChild(panel);

  const blurCursor = document.createElement('div');
  blurCursor.id = 'blur-cursor-follower';
  document.body.appendChild(blurCursor);

  const canvas = document.getElementById('editor-canvas');
  const ctx = canvas.getContext('2d');
  const cropOverlay = document.getElementById('crop-overlay');
  const statusLbl = document.getElementById('flux-status');

  // ══════════════════════════════════════════════════════
  //  2. DRAG, DROP, & SIGNAL TRAPS
  // ══════════════════════════════════════════════════════
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const isTopRight = (window.innerWidth - e.clientX) < 180 && e.clientY < 180;
    if (panel.style.display !== 'flex') {
      hotzone.classList.toggle('visible', isTopRight);
    }
  });

  hotzone.addEventListener('dragenter', (e) => { e.preventDefault(); hotzone.classList.add('active'); });
  hotzone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  hotzone.addEventListener('dragleave', () => hotzone.classList.remove('active'));
  document.addEventListener('dragend', () => hotzone.classList.remove('visible'));

  hotzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hotzone.classList.remove('visible', 'active');
    
    statusLbl.innerText = "Fetching image data...";
    panel.style.display = 'flex';

    const htmlData = e.dataTransfer.getData('text/html');
    const match = htmlData.match(/src="([^"]+)"/);
    const imageUrl = match ? match[1] : e.dataTransfer.getData('text/plain');

    if (imageUrl) {
      chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: imageUrl }, (response) => {
        if (response && response.dataUrl) {
          activeImg.src = response.dataUrl;
          activeImg.onload = () => {
            canvas.width = activeImg.width;
            canvas.height = activeImg.height;
            ctx.drawImage(activeImg, 0, 0);
            
            historyStack = [canvas.toDataURL()];
            statusLbl.innerText = `${canvas.width}×${canvas.height}px`;
            resetWorkspaceTools();
          };
        } else {
          statusLbl.innerText = "Fetch Error ❌";
        }
      });
    }
  });

  // ══════════════════════════════════════════════════════
  //  3. THE 8-POINT CROP SYSTEM
  // ══════════════════════════════════════════════════════
  function updateCropUI() {
    // Get scaling ratio between the true source canvas buffer dimensions and display viewport rendering area
    const scaleX = canvas.clientWidth / canvas.width;
    const scaleY = canvas.clientHeight / canvas.height;

    cropOverlay.style.left = (canvas.offsetLeft + cropBox.x * scaleX) + 'px';
    cropOverlay.style.top = (canvas.offsetTop + cropBox.y * scaleY) + 'px';
    cropOverlay.style.width = (cropBox.w * scaleX) + 'px';
    cropOverlay.style.height = (cropBox.h * scaleY) + 'px';
  }

  cropOverlay.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    if (currentTool !== 'crop') return;

    if (e.target.classList.contains('crop-handle')) {
      activeHandle = e.target.getAttribute('data-handle');
    } else {
      activeHandle = 'move';
    }

    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    cropStartBox = { ...cropBox };
  });

  document.addEventListener('mousemove', (e) => {
    if (!activeHandle || currentTool !== 'crop') return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Relative mouse position variations scaled back into full-resolution units
    const deltaX = (e.clientX - dragStart.x) * scaleX;
    const deltaY = (e.clientY - dragStart.y) * scaleY;

    if (activeHandle === 'move') {
      cropBox.x = Math.max(0, Math.min(cropStartBox.x + deltaX, canvas.width - cropBox.w));
      cropBox.y = Math.max(0, Math.min(cropStartBox.y + deltaY, canvas.height - cropBox.h));
    } else {
      // Boundaries check
      let currentRight = cropStartBox.x + cropStartBox.w;
      let currentBottom = cropStartBox.y + cropStartBox.h;

      // Handle structural mutations depending on dot orientation vector mappings
      if (activeHandle.includes('r')) {
        cropBox.w = Math.max(20, Math.min(cropStartBox.w + deltaX, canvas.width - cropStartBox.x));
      }
      if (activeHandle.includes('l')) {
        let desiredX = Math.max(0, Math.min(cropStartBox.x + deltaX, currentRight - 20));
        cropBox.x = desiredX;
        cropBox.w = currentRight - desiredX;
      }
      if (activeHandle.includes('b')) {
        cropBox.h = Math.max(20, Math.min(cropStartBox.h + deltaY, canvas.height - cropStartBox.y));
      }
      if (activeHandle.includes('t')) {
        let desiredY = Math.max(0, Math.min(cropStartBox.y + deltaY, currentBottom - 20));
        cropBox.y = desiredY;
        cropBox.h = currentBottom - desiredY;
      }
    }
    updateCropUI();
  });

  document.addEventListener('mouseup', () => {
    if (activeHandle && currentTool === 'crop') {
      activeHandle = null;
    }
  });

  // Split logic out so it only crops when hitting "Apply Crop Cut"
  document.getElementById('action-trigger-crop').onclick = () => {
    if (currentTool !== 'crop') return;
    if (cropBox.w < 5 || cropBox.h < 5) return;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropBox.w;
    tempCanvas.height = cropBox.h;
    
    tempCanvas.getContext('2d').drawImage(canvas, cropBox.x, cropBox.y, cropBox.w, cropBox.h, 0, 0, cropBox.w, cropBox.h);
    
    canvas.width = cropBox.w;
    canvas.height = cropBox.h;
    ctx.drawImage(tempCanvas, 0, 0);

    saveStateToStack();
    resetWorkspaceTools();
    statusLbl.innerText = `${canvas.width}×${canvas.height}px`;
  };

  // ══════════════════════════════════════════════════════
  //  4. INTERACTIVE BLUR BRUSH
  // ══════════════════════════════════════════════════════
  const intSlider = document.getElementById('blur-intensity-slider');
  const sizeSlider = document.getElementById('blur-size-slider');

  intSlider.oninput = (e) => blurIntensity = parseInt(e.target.value);
  sizeSlider.oninput = (e) => {
    blurRadius = parseInt(e.target.value) / 2;
    blurCursor.style.width = e.target.value + 'px';
    blurCursor.style.height = e.target.value + 'px';
  };

  canvas.addEventListener('mouseenter', () => { if (currentTool === 'blur') blurCursor.style.display = 'block'; });
  canvas.addEventListener('mouseleave', () => { blurCursor.style.display = 'none'; isDrawingBlur = false; });
  
  canvas.addEventListener('mousemove', (e) => {
    blurCursor.style.left = e.clientX + 'px';
    blurCursor.style.top = e.clientY + 'px';
    if (isDrawingBlur && currentTool === 'blur') applyBlurBrushStroke(e);
  });

  canvas.addEventListener('mousedown', (e) => {
    if (currentTool === 'blur') {
      isDrawingBlur = true;
      applyBlurBrushStroke(e);
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (isDrawingBlur && currentTool === 'blur') {
      isDrawingBlur = false;
      saveStateToStack();
    }
  });

  function applyBlurBrushStroke(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, blurRadius * scaleX, 0, Math.PI * 2);
    ctx.clip();

    ctx.filter = `blur(${blurIntensity}px)`;
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════
  //  5. TOOLS STATE ENGINE
  // ══════════════════════════════════════════════════════
  function resetWorkspaceTools() {
    currentTool = null;
    cropOverlay.style.display = 'none';
    blurCursor.style.display = 'none';
    document.getElementById('blur-controls').style.display = 'none';
    document.getElementById('tool-crop').classList.remove('active-tool');
    document.getElementById('tool-blur').classList.remove('active-tool');
  }

  document.getElementById('tool-crop').onclick = () => {
    if (currentTool === 'crop') { resetWorkspaceTools(); return; }
    resetWorkspaceTools();
    currentTool = 'crop';
    document.getElementById('tool-crop').classList.add('active-tool');
    
    // Default the box to a centered 60% square layout upon invocation
    cropBox = { 
      x: canvas.width * 0.2, 
      y: canvas.height * 0.2, 
      w: canvas.width * 0.6, 
      h: canvas.height * 0.6 
    };
    cropOverlay.style.display = 'block';
    updateCropUI();
  };

  document.getElementById('tool-blur').onclick = () => {
    if (currentTool === 'blur') { resetWorkspaceTools(); return; }
    resetWorkspaceTools();
    currentTool = 'blur';
    document.getElementById('tool-blur').classList.add('active-tool');
    document.getElementById('blur-controls').style.display = 'flex';
    blurCursor.style.width = sizeSlider.value + 'px';
    blurCursor.style.height = sizeSlider.value + 'px';
  };

  document.getElementById('action-resize').onclick = () => {
    resetWorkspaceTools();
    const w = canvas.width * 0.5;
    const h = canvas.height * 0.5;
    if (w < 10 || h < 10) return;

    const temp = document.createElement('canvas');
    temp.width = w; temp.height = h;
    temp.getContext('2d').drawImage(canvas, 0, 0, w, h);
    
    canvas.width = w; canvas.height = h;
    ctx.drawImage(temp, 0, 0);
    
    saveStateToStack();
    statusLbl.innerText = `${w}×${h}px`;
  };

  // REVERT INFRASTRUCTURE
  document.getElementById('action-revert').onclick = () => {
    resetWorkspaceTools();
    if (historyStack.length <= 1) {
      statusLbl.innerText = "Baseline state";
      return;
    }
    
    historyStack.pop();
    const previousStateImg = new Image();
    previousStateImg.src = historyStack[historyStack.length - 1];
    
    previousStateImg.onload = () => {
      canvas.width = previousStateImg.width;
      canvas.height = previousStateImg.height;
      ctx.drawImage(previousStateImg, 0, 0);
      statusLbl.innerText = `${canvas.width}×${canvas.height}px`;
    };
  };

  function saveStateToStack() {
    const stateUrl = canvas.toDataURL();
    if (stateUrl !== historyStack[historyStack.length - 1]) {
      historyStack.push(stateUrl);
    }
  }

  // ══════════════════════════════════════════════════════
  //  6. COMPILE RUNTIME CLIPBOARD MATRIX
  // ══════════════════════════════════════════════════════
  document.getElementById('action-copy').onclick = () => {
    resetWorkspaceTools();
    statusLbl.innerText = "Compiling PNG...";
    
    canvas.toBlob(async (blob) => {
      try {
        const item = new ClipboardItem({ "image/png": blob });
        await navigator.clipboard.write([item]);
        statusLbl.innerText = "Copied! ✅";
      } catch (err) {
        console.error(err);
        statusLbl.innerText = "Write Error ❌";
      }
    }, 'image/png');
  };

  document.getElementById('action-close').onclick = () => {
    resetWorkspaceTools();
    panel.style.display = 'none';
  };

  // ══════════════════════════════════════════════════════
  //  7. MODULE DRAG & POSITION MOVEMENTS
  // ══════════════════════════════════════════════════════
  const titlebar = document.getElementById('flux-titlebar');
  let isPanelDragging = false, offsetOffsetX = 0, offsetOffsetY = 0;

  titlebar.addEventListener('mousedown', (e) => {
    isPanelDragging = true;
    const panelBounds = panel.getBoundingClientRect();
    offsetOffsetX = e.clientX - panelBounds.left;
    offsetOffsetY = e.clientY - panelBounds.top;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanelDragging) return;
    panel.style.left = (e.clientX - offsetOffsetX) + 'px';
    panel.style.top = (e.clientY - offsetOffsetY) + 'px';
  });

  document.addEventListener('mouseup', () => isPanelDragging = false);

})();