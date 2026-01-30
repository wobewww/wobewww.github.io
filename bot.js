const GITHUB_OWNER = 'wobewww';
const GITHUB_REPO = 'wobewww.github.io';
const CONTENT_PATH = 'content/blog/';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
      const update = await request.json();
      if (!update.message) return new Response('No message', { status: 200 });

      const senderId = String(update.message.from.id);
      const allowedId = String(env.TELEGRAM_USER_ID);
      if (senderId !== allowedId) return new Response('Unauthorized', { status: 403 });

      let textContent = '';
      let fileObject = null;

      if (update.message.document && update.message.caption) {
        textContent = update.message.caption;
        fileObject = update.message.document;
      } else if (update.message.text) {
        textContent = update.message.text;
      } else if (update.message.photo && update.message.caption) {
        textContent = update.message.caption;
        fileObject = update.message.photo[update.message.photo.length - 1];
      } else {
        return new Response('No content', { status: 200 });
      }

      const result = await publishToGithub(textContent, fileObject, env);
      await sendTelegramMessage(update.message.chat.id, result, env);
      return new Response('Ok', { status: 200 });
    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  },
};

async function publishToGithub(text, fileObject, env) {
  const lines = text.split('\n');
  if (lines.length < 5) return "El formato correcto de uso es: \n\nTítulo\nDescripción\nCategorías\nEtiquetas\nTexto...";

  const title = lines[0].trim();
  const description = lines[1].trim();
  const categories = formatArray(lines[2].trim());
  const tags = formatArray(lines[3].trim());
  let body = lines.slice(4).join('\n').trim();

  const today = new Date().toISOString().split('T')[0];
  const slug = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
  const folderPath = `${CONTENT_PATH}${slug}/`;

  if (fileObject) {
    try {
      const extension = (fileObject.file_name || 'img.jpg').split('.').pop();
      const imageFileName = `image.${extension}`;
      const photoBuffer = await downloadTelegramFile(fileObject.file_id, env.TELEGRAM_BOT_TOKEN);
      
      await uploadFileToGithub(env, `${folderPath}${imageFileName}`, photoBuffer, `Image for ${title}`);

      // Función actualizada para usar tu shortcode de Hugo
      const hugoShortcode = (caption) => `\n{{< img src="${imageFileName}" alt="${caption}" caption="${caption}" >}}\n`;
      
      const regex = /\[IMAGEN:\s*(.*?)\]/g;
      if (regex.test(body)) {
        // Si el usuario puso , lo reemplazamos
        body = body.replace(regex, (match, p1) => hugoShortcode(p1));
      } else {
        // Si no hay tag, se añade al final por defecto
        body += `\n${hugoShortcode("Imagen del post")}`;
      }
    } catch (err) {
      return `Error imagen: ${err.message}`;
    }
  }

  const fileContent = `---
title: "${title}"
date: ${today}
draft: false
description: "${description}"
categories: ${categories}
tags: ${tags}
---

${body}`;

  const response = await uploadFileToGithub(env, `${folderPath}index.md`, new TextEncoder().encode(fileContent), `Post: ${title}`);

  if (response.ok) {
    return `Publicado: https://wobewww.github.io/blog/${slug}/`;
  } else {
    const error = await response.json();
    return `Error GitHub: ${error.message}`;
  }
}

// --- UTILS ---
async function downloadTelegramFile(fileId, botToken) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const info = await res.json();
  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`);
  return await fileRes.arrayBuffer();
}

async function uploadFileToGithub(env, path, contentBuffer, commitMessage) {
  let binary = '';
  const bytes = new Uint8Array(contentBuffer);
  for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
  const contentBase64 = btoa(binary);

  return await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_USER_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Cloudflare-Worker'
    },
    body: JSON.stringify({ message: commitMessage, content: contentBase64 })
  });
}

function formatArray(str) {
  if (!str || str === "[]") return "[]";
  return `[${str.split(',').map(s => `"${s.trim()}"`).join(', ')}]`;
}

async function sendTelegramMessage(chatId, text, env) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, disable_web_page_preview: true })
  });
}
