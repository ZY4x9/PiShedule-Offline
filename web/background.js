(() => {
  const key = 'pischedule-background';
  const native = window.PiDatabase;
  const input = document.querySelector('#background-file');
  let current = '';

  function accentFrom(image) {
    const sample = document.createElement('canvas');
    sample.width = sample.height = 40;
    const context = sample.getContext('2d', {willReadFrequently:true});
    context.drawImage(image, 0, 0, 40, 40);
    const pixels = context.getImageData(0, 0, 40, 40).data;
    const colors = new Map();
    let dominant;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index], g = pixels[index+1], b = pixels[index+2];
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const bin = colors.get(key) || {count:0, r:0, g:0, b:0};
      bin.count++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      colors.set(key, bin);
      if (!dominant || bin.count > dominant.count) dominant = bin;
    }
    const rgb = [dominant.r, dominant.g, dominant.b].map(value => value / dominant.count);
    // Limit the brightness to retain white button text and dark-on-glass contrast.
    const scale = Math.min(1, 105 / Math.max(1, ...rgb));
    return rgb.map(value => Math.round(16 + value * scale)).join(', ');
  }
  function setAccent(color) {
    if (color) document.documentElement.style.setProperty('--accent-rgb', color);
    else document.documentElement.style.removeProperty('--accent-rgb');
  }
  function apply(value, accent) {
    current = value;
    if (value) document.body.style.setProperty('--wallpaper', 'url("' + value + '")');
    else document.body.style.removeProperty('--wallpaper');
    setAccent(accent);
    document.body.classList.toggle('custom-background', Boolean(value));
  }
  function save(value, accent) {
    if (native) {
      if (!native.saveBackground(value)) throw Error('背景图保存失败，请换一张较小的图片。');
    } else if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    apply(value, accent);
  }
  try {
    const saved = native ? native.readBackground() : localStorage.getItem(key);
    if (/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(saved ?? '')) {
      apply(saved);
      const image = new Image();
      image.src = saved;
      image.decode().then(() => {
        if (current === saved) setAccent(accentFrom(image));
      }).catch(() => {});
    }
  } catch {
    message('背景图读取失败。');
  }
  document.addEventListener('click', event => {
    if (event.target.closest('#choose-background')) input.click();
    if (event.target.closest('#reset-background') && current) {
      try { save(''); message('已恢复默认背景。'); }
      catch { message('背景图恢复失败。'); }
    }
  });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { message('请选择 15 MB 以内的图片。'); return; }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      save(canvas.toDataURL('image/jpeg', 0.76), accentFrom(canvas));
      message('已更换背景图。');
    } catch (error) {
      message(error.message || '无法读取图片。');
    } finally {
      URL.revokeObjectURL(url);
    }
  });
})();
