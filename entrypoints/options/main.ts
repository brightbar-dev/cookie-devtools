import './style.css';

document.addEventListener('DOMContentLoaded', async () => {
  const themeSelect = document.getElementById('theme') as HTMLSelectElement;
  const maxLogSelect = document.getElementById('max-log') as HTMLSelectElement;

  const data = await browser.storage.local.get({ theme: 'auto', maxLog: 500 });
  themeSelect.value = data.theme as string;
  maxLogSelect.value = String(data.maxLog);

  themeSelect.addEventListener('change', () => {
    browser.storage.local.set({ theme: themeSelect.value });
  });

  maxLogSelect.addEventListener('change', () => {
    browser.storage.local.set({ maxLog: parseInt(maxLogSelect.value) });
  });

  document.getElementById('btn-clear-data')!.addEventListener('click', async () => {
    if (confirm('This will delete all saved profiles and the change log. Continue?')) {
      await browser.storage.local.set({ profiles: {}, changeLog: [] });
      alert('All data cleared.');
    }
  });
});
