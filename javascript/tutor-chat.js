let isProcessing = false;

// ── Pedagogical mode tracking ─────────────────────────────────────────────
// Counts completed exchange rounds (1 user msg + 1 bot msg = 1 round).
// After round 5 the student is offered a choice (S-DO prompt).
// teachingMode: 'socratic' | 'didactic' | 'pending_choice'
let exchangeRounds = 0;        // incremented after each bot reply
let teachingMode = 'socratic'; // starts in Socratic mode
let sdoPromptSent = false;     // true once the S-DO choice message has been sent

const SOCRATIC_SYSTEM = `You are an AI physics tutor using the Socratic method. Your role is to guide the student to discover answers themselves through carefully sequenced questions — never by giving the answer directly.

━━━ SOCRATIC MODE — MANDATORY RULES ━━━

RULE 1 — GUIDE, NEVER TELL:
You MUST NOT give the answer or a complete explanation. Instead, ask a question that nudges the student one step closer to the answer. Build on what the student just said.

RULE 2 — ONE QUESTION PER RESPONSE:
Every response must end with exactly one focused question. Do not ask multiple questions at once.

RULE 3 — BUILD ON PRIOR KNOWLEDGE:
Start from what the student already knows. Reference their previous answers to construct the next question. If they are stuck, ask a simpler sub-question that breaks the problem into a smaller piece.

RULE 4 — WARM AND ENCOURAGING TONE:
Acknowledge the student's effort genuinely before redirecting. Use phrases like:
- "That's a useful starting point — now think about..."
- "You're on the right track. What happens when..."
- "Good instinct. Can you tell me why..."
Never be cold or dismissive.

RULE 5 — STUDENT-DRIVEN DISCOVERY:
The student must feel they are arriving at the answer themselves. Your questions should feel like natural next steps, not interrogation.

RULE 6 — NO UNSOLICITED FULL EXPLANATIONS:
Do not volunteer complete derivations or full concept explanations unless the student has been asked to switch to Didactic mode (reply "D").

Focus on core introductory physics topics.`;

const DIDACTIC_SYSTEM = `You are an AI physics tutor in Didactic mode. The student has worked through the problem with you and has now asked for a direct, complete explanation.

━━━ DIDACTIC MODE — MANDATORY RULES ━━━

RULE 1 — GIVE THE FULL EXPLANATION:
Provide a clear, step-by-step explanation. Show all relevant reasoning, equations, and derivations. Leave nothing ambiguous.

RULE 2 — REFERENCE PRIOR EXCHANGES:
Acknowledge what the student already figured out during the Socratic phase before you fill in the remaining gaps.

RULE 3 — WARM AND DIRECT:
Be encouraging. The student earned this explanation. Keep the tone supportive and clear.

RULE 4 — USE COURSE MATERIALS:
Ground your explanation in the provided COURSE MATERIALS context wherever possible.

Focus on core introductory physics topics.`;

const SHARED_INSTRUCTIONS = `
REFERENCE LINKS INSTRUCTIONS:
You have access to the student's physics course materials including lecture slides, textbook chapters, and other uploaded resources. Relevant excerpts will be provided in context under "COURSE MATERIALS".
When answering, ALWAYS ground your response in the provided course material excerpts. Quote or paraphrase directly from them when relevant. Prefer the course materials over general knowledge.
Do NOT invent, paraphrase, or rename source materials. If you refer to a source in your response text, use its EXACT name as listed in the COURSE MATERIALS context — nothing else.

CITATION RULE: Do NOT write any citation lines or source references in your response. Citations are handled automatically by the system from the provided COURSE MATERIALS context.`;

// Returns the active system prompt based on current teaching mode
function getSystemPrompt() {
	const base = teachingMode === 'didactic' ? DIDACTIC_SYSTEM : SOCRATIC_SYSTEM;
	return base + SHARED_INSTRUCTIONS;
}

function resetTopicTracking() {
	exchangeRounds = 0;
	sdoPromptSent = false;
	teachingMode = 'socratic';
	context[0] = { role: 'system', content: getSystemPrompt() };
}

let context = [
	{
		role: 'system',
		content: getSystemPrompt()
	}
];

const searchCache = new Map();
window.chatInitialized = false;

function maybeInitializeChat() {
    if (!window.chatInitialized) {
        initializeChat();
    }
}

document.addEventListener('DOMContentLoaded', maybeInitializeChat);

if (document.readyState === 'interactive' || document.readyState === 'complete') {
    maybeInitializeChat();
}

function handlePasteEvent(event) {
    const activeElement = document.activeElement;
    const chatInput = document.getElementById('chatInput');
    if (activeElement !== chatInput) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.indexOf('image') === 0) {
            const file = item.getAsFile();
            if (file) {
                uploadedFiles.push(file);
                addFileToPreview(file);
                const filePreview = document.getElementById('filePreview');
                filePreview.style.display = 'flex';
            }
        }
    }
}

function initializeChat() {
    if (window.chatInitialized) return;
    window.chatInitialized = true;
    window.processUserMessage = processUserMessage;
    window.initializeChat = initializeChat;

    // Expose teaching-mode state so session-manager can apply class-wide mode changes
    window.getSystemPrompt = getSystemPrompt;
    window.resetTopicTracking = resetTopicTracking;
    Object.defineProperty(window, 'teachingMode', {
      get: () => teachingMode,
      set: (v) => { teachingMode = v; },
      configurable: true,
    });
    Object.defineProperty(window, 'context', {
      get: () => context,
      set: (v) => { context = v; },
      configurable: true,
    });

    // Allow external code (e.g. whiteboard) to inject a File into the upload queue
    window.injectFileIntoChat = function (file) {
        uploadedFiles.push(file);
        addFileToPreview(file);
        const fp = document.getElementById('filePreview');
        if (fp) fp.style.display = 'flex';
    };
    const sendButton = document.getElementById('sendButton');
    const chatInput = document.getElementById('chatInput');

    if (sendButton) {
        sendButton.addEventListener('click', handleSendMessage);
    }

    if (chatInput) {
        chatInput.addEventListener('keypress', handleKeyPress);
    }

    initializeFileUpload();
    initializeDragDrop();
    createChatControls();
    initializeVoiceInput();

    addMessage("Hi there! I'm your physics tutor! Ask me anything about physics!", 'bot');

    document.addEventListener('paste', handlePasteEvent);

    // ── Expose hooks for chat-history-manager ──────────────────────────────

    // Reset context to just the system prompt
    window._resetChatContext = function () {
        context = [{ role: 'system', content: getSystemPrompt() }];
        resetTopicTracking();
    };

    // Add a message to the UI without triggering any DB save (used when replaying history)
    window._addMessageSilent = function (text, sender) {
        _addMessageInternal(text, sender, [], null, /*silent=*/true);
    };

    // Rebuild the AI context from stored message array
    window._rebuildContext = function (messages) {
        context = [{ role: 'system', content: getSystemPrompt() }]; // keep system prompt
        messages.forEach(m => {
            context.push({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.content });
        });
        // Trim to max size
        const max = 18;
        if (context.length > max) context = [context[0], ...context.slice(-(max - 1))];
    };

    // Build citation pill HTML from a citations array — shared with addSharedMessage
    // in session-manager.js so in-class bot messages get the same pills.
    window._buildCitationHTML = function (citation) {
        if (!citation || citation.length === 0) return '';
        return citation.map(c => {
            const pageLabel = c.page ? ` · p.${c.page}` : '';
            const icon = getSourceIcon(c.name);
            const safeName = (c.name || '').replace(/'/g, "\\'");

            if (/video links|lecture video/i.test(c.name || '')) return '';

            const isTextbook = /college physics|textbook|physics.?2e/i.test(c.name || '');
            if (isTextbook && c.page) {
                return `<span class="citation-pill" onclick="showBookRef(${c.page})" style="cursor:pointer" title="View page ${c.page}">${icon} ${c.name}${pageLabel}</span>`;
            }
            if (c.drive_file_id) {
                const driveUrl = `https://drive.google.com/file/d/${c.drive_file_id}/preview${c.page ? `#page=${c.page}` : ''}`;
                return `<span class="citation-pill" onclick="showDriveRef('${driveUrl}','${safeName}',${c.page||'null'})" style="cursor:pointer" title="View source">${icon} ${c.name}${pageLabel}</span>`;
            }
            if (c.url) return '';
            if (c.text) {
                const safeText = c.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
                return `<span class="citation-pill" onclick="showTextRef('${safeText}','${safeName}',${c.page||1})" style="cursor:pointer" title="View source">${icon} ${c.name}${pageLabel}</span>`;
            }
            if (!c.name) return '';
            return `<span class="citation-pill" title="Source reference">${icon} ${c.name}${pageLabel}</span>`;
        }).join('');
    };
}
let uploadedFiles = [];

function initializeFileUpload() {
	const uploadButton = document.getElementById('uploadButton');
	const fileInput = document.getElementById('fileInput');

	if (uploadButton && fileInput) {
		uploadButton.addEventListener('click', () => fileInput.click());
		fileInput.addEventListener('change', handleFileSelect);
	}
}

function initializeDragDrop() {
	const chatContainer = document.querySelector('.chat-container');
	if (!chatContainer) return;

	chatContainer.addEventListener('dragover', (e) => {
		e.preventDefault();
		chatContainer.style.backgroundColor = '#f0f8ff';
	});

	chatContainer.addEventListener('dragleave', (e) => {
		e.preventDefault();
		chatContainer.style.backgroundColor = '';
	});

	chatContainer.addEventListener('drop', (e) => {
		e.preventDefault();
		chatContainer.style.backgroundColor = '';
		const files = Array.from(e.dataTransfer.files);
		handleDroppedFiles(files);
	});
}

function handleDroppedFiles(files) {
	const filePreview = document.getElementById('filePreview');

	files.forEach((file) => {
		if (isValidFileType(file)) {
			uploadedFiles.push(file);
			addFileToPreview(file);
		} else {
			addMessage(
				`File type "${file.type}" is not supported. Please upload PDF, images, videos, audio, or text files.`,
				'bot'
			);
		}
	});

	if (uploadedFiles.length > 0) {
		filePreview.style.display = 'flex';
	}
}
async function getGeminiResponse(messages, files = []) {
	try {
		const response = await fetch('/api/gemini', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ messages, files })
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
		}

		const data = await response.json();
		return data.response || 'No response received from Gemini.';
	} catch (error) {


		// Provide user-friendly error messages
		if (error.message.includes('fetch')) {
			throw new Error('Unable to connect to the AI service. Please check your internet connection.');
		} else if (error.message.includes('429')) {
			throw new Error('Too many requests. Please wait a moment and try again.');
		} else if (error.message.includes('401')) {
			throw new Error('API authentication failed. Please check your configuration.');
		} else {
			throw new Error('AI service is temporarily unavailable. Please try again.');
		}
	}
}

function handleFileSelect(event) {
	const files = Array.from(event.target.files);
	const filePreview = document.getElementById('filePreview');

	files.forEach((file) => {
		if (isValidFileType(file)) {
			uploadedFiles.push(file);
			addFileToPreview(file);
		} else {
			addMessage(
				`File type "${file.type}" is not supported. Please upload PDF, images, videos, audio, or text files.`,
				'bot'
			);
		}
	});

	// Show file preview container if files are uploaded
	if (uploadedFiles.length > 0) {
		filePreview.style.display = 'flex';
	}

	event.target.value = '';
}

function isValidFileType(file) {
	const validTypes = [
		'application/pdf',
		'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
		'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
		'audio/wav', 'audio/mp3', 'audio/mpeg',
		'text/plain', 'text/html', 'text/css', 'application/javascript'
	];
	return validTypes.includes(file.type);
}

function addFileToPreview(file) {
	const filePreview = document.getElementById('filePreview');
	const fileItem = document.createElement('div');
	fileItem.className = 'file-item';
	fileItem.dataset.fileName = file.name;

	const fileIcon = getFileIcon(file.type);
	const fileName = file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name;

	fileItem.innerHTML = `
        <span class="file-icon">${fileIcon}</span>
        <span class="file-name" title="${file.name}" onclick="viewFile('${file.name}')" style="cursor: pointer; color: #007bff;">${fileName}</span>
        <button class="remove-file" onclick="removeFile('${file.name}')">×</button>
    `;

	filePreview.appendChild(fileItem);
}

function getFileIcon(fileType) {
	if (fileType === 'application/pdf') return '📄';
	if (fileType.startsWith('image/')) return '🖼️';
	return '📎';
}

function removeFile(fileName) {
	uploadedFiles = uploadedFiles.filter((file) => file.name !== fileName);
	const fileItem = document.querySelector(`.file-item[data-file-name="${fileName}"]`);
	if (fileItem) {
		fileItem.remove();
	}

	// Hide file preview container if no files remain
	const filePreview = document.getElementById('filePreview');
	if (uploadedFiles.length === 0) {
		filePreview.style.display = 'none';
	}
}

function viewFile(fileName) {
	const file = uploadedFiles.find((f) => f.name === fileName);
	if (!file) return;

	const modal = document.createElement('div');
	modal.className = 'file-viewer-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0,0,0,0.8);
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
	`;

	const content = document.createElement('div');
	content.style.cssText = `
		background: white;
		border-radius: 8px;
		max-width: 90%;
		max-height: 90%;
		overflow: auto;
		position: relative;
	`;

	const closeBtn = document.createElement('button');
	closeBtn.innerHTML = '×';
	closeBtn.style.cssText = `
		position: absolute;
		top: 10px;
		right: 15px;
		background: none;
		border: none;
		font-size: 24px;
		cursor: pointer;
		z-index: 1;
	`;
	closeBtn.onclick = () => modal.remove();

	if (file.type.startsWith('image/')) {
		const img = document.createElement('img');
		img.src = URL.createObjectURL(file);
		img.style.cssText = 'max-width: 100%; max-height: 100%; display: block;';
		content.appendChild(img);
	} else if (file.type === 'application/pdf') {
		const iframe = document.createElement('iframe');
		iframe.src = URL.createObjectURL(file);
		iframe.style.cssText = 'width: 80vw; height: 80vh; border: none;';
		content.appendChild(iframe);
	}

	content.appendChild(closeBtn);
	modal.appendChild(content);
	document.body.appendChild(modal);

	modal.onclick = (e) => {
		if (e.target === modal) modal.remove();
	};
}

async function processFilesForTutor(files) {
	const processedFiles = [];

	for (const file of files) {
		if (file.size > 10 * 1024 * 1024) {
			throw new Error('File too large (max 10MB)');
		}

		const base64 = await fileToBase64(file);
		const fileEntry = {
			name: file.name,
			type: file.type,
			data: base64
		};

		if (file.type.startsWith('image/')) {
			try {
				const ocrText = await getOcrFromImage(base64);
				if (ocrText && ocrText.trim() && ocrText.trim().toLowerCase() !== 'error reading image text.') {
					fileEntry.ocrText = ocrText.trim();
				}
			} catch (ocrError) {
				fileEntry.ocrText = null;
			}
		}

		processedFiles.push(fileEntry);
	}

	return processedFiles;
}

function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		const timeout = setTimeout(() => {
			reader.abort();
			reject(new Error('File reading timeout'));
		}, 30000); // 30 second timeout
		
		reader.onload = () => {
			clearTimeout(timeout);
			resolve(reader.result);
		};
		
		reader.onerror = () => {
			clearTimeout(timeout);
			reject(new Error('Failed to read file'));
		};
		
		reader.onabort = () => {
			clearTimeout(timeout);
			reject(new Error('File reading was aborted'));
		};
		
		try {
			reader.readAsDataURL(file);
		} catch (error) {
			clearTimeout(timeout);
			reject(error);
		}
	});
}

async function getOcrFromImage(base64Image) {
	const endpoints = ['/api/ocr', 'https://tutor.probabilitycourse.com/api/ocr'];

	for (const endpoint of endpoints) {
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ image: base64Image })
			});

			if (!response.ok) {
				continue;
			}

			const data = await response.json();

			if (data.text && data.text.trim()) {
				return data.text;
			} else if (Array.isArray(data.data) && data.data.length > 0) {
				return data.data.map((entry) => entry.value || '').join(' ');
			} else {
				return 'No recognizable text found in image.';
			}
		} catch (error) {
			continue;
		}
	}

	return 'Error reading image text.';
}

function createChatControls() {
	const chatContainer = document.querySelector('.chat-container');
	const existingControls = document.getElementById('chatControls');
	if (!chatContainer) return;
	if (existingControls) {
		if (!chatContainer.contains(existingControls)) {
			existingControls.remove();
		} else {
			return;
		}
	}

	const controlsDiv = document.createElement('div');
	controlsDiv.id = 'chatControls';
	controlsDiv.style.cssText = `
		display: flex;
		gap: 8px;
		padding: 10px 15px;
		background: #f8f9fa;
		border-bottom: 1px solid #e0e0e0;
		flex-shrink: 0;
	`;

	const saveBtn = document.createElement('button');
	saveBtn.innerHTML = '💾 Save Chat';
	saveBtn.style.cssText = `
		padding: 6px 12px;
		border: 1px solid #ddd;
		border-radius: 15px;
		background: #881c1c;
		color: white;
		cursor: pointer;
		font-size: 12px;
		transition: all 0.3s ease;
	`;
	saveBtn.addEventListener('click', saveChatHistory);

	const summaryBtn = document.createElement('button');
	summaryBtn.innerHTML = '📝 Generate Summary';
	summaryBtn.style.cssText = `
		padding: 6px 12px;
		border: 1px solid #ddd;
		border-radius: 15px;
		background: #881c1c;
		color: white;
		cursor: pointer;
		font-size: 12px;
		transition: all 0.3s ease;
	`;
	summaryBtn.addEventListener('click', generateChatSummary);

	const quizBtn = document.createElement('button');
	quizBtn.innerHTML = 'Quiz';
	quizBtn.id = 'quizControlBtn';
	quizBtn.style.cssText = `
		padding: 6px 12px;
		border: 1px solid #ddd;
		border-radius: 15px;
		background: #881c1c;
		color: white;
		cursor: pointer;
		font-size: 12px;
		transition: all 0.3s ease;
	`;
	quizBtn.addEventListener('click', () => {
		if (window.quizIntegration) window.quizIntegration.showQuizMenu();
	});

	controlsDiv.appendChild(saveBtn);
	controlsDiv.appendChild(summaryBtn);
	controlsDiv.appendChild(quizBtn);
	chatContainer.insertBefore(controlsDiv, chatContainer.firstChild);
}

function initializeVoiceInput() {
	const micBtn = document.getElementById('voiceInputBtn');
	if (!micBtn || !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
		if (micBtn) micBtn.style.display = 'none';
		return;
	}

	const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
	const recognition = new SpeechRecognition();
	recognition.continuous = false;
	recognition.interimResults = false;
	recognition.lang = 'en-US';

	let listening = false;

	recognition.onresult = (e) => {
		const transcript = e.results[0][0].transcript;
		const chatInput = document.getElementById('chatInput');
		if (chatInput) chatInput.value = transcript;
	};

	recognition.onend = () => {
		listening = false;
		micBtn.style.background = '';
		micBtn.title = 'Click to speak';
	};

	micBtn.addEventListener('click', () => {
		if (listening) {
			recognition.stop();
		} else {
			recognition.start();
			listening = true;
			micBtn.style.background = 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)';
			micBtn.title = 'Listening... click to stop';
		}
	});
}

function handleKeyPress(event) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		handleSendMessage();
	}
}

function handleSendMessage() {
	const input = document.getElementById('chatInput');
	const message = input.value.trim();

	if ((message || uploadedFiles.length > 0) && !isProcessing) {
		processUserMessage(message);
		input.value = '';
	}
}

function addMessage(text, sender, files = [], citation = null) {
	_addMessageInternal(text, sender, files, citation, false);
}

function _addMessageInternal(text, sender, files = [], citation = null, silent = false) {
	// Reset the idle-logout timer on every chat message (user or bot)
	if (window.resetIdleChatTimer) window.resetIdleChatTimer();

	const chatMessages = document.getElementById('chatMessages');
	const messageDiv = document.createElement('div');
	messageDiv.className = `message ${sender}-message slide-in`;

	const avatar = document.createElement('div');
	avatar.className = 'message-avatar';
	avatar.innerHTML = sender === 'bot' ? '🤖' : '👤';

	// Convert LaTeX to Unicode for bot messages
	// Protect $...$ and $$...$$ blocks from unicode conversion so KaTeX can render them
	let displayText = text;
	if (sender === 'bot' && window.convertLatexToUnicode) {
		// Temporarily pull out math blocks before unicode conversion
		const mathBlocks = [];
		let protected_text = displayText
			.replace(/\$\$[\s\S]+?\$\$/g, (m) => { mathBlocks.push(m); return `\x00MATH${mathBlocks.length - 1}\x00`; })
			.replace(/\$[^$\n]+?\$/g,      (m) => { mathBlocks.push(m); return `\x00MATH${mathBlocks.length - 1}\x00`; });
		protected_text = window.convertLatexToUnicode(protected_text);
		// Restore math blocks
		displayText = protected_text.replace(/\x00MATH(\d+)\x00/g, (_, i) => mathBlocks[i]);
	}

	const content = document.createElement('div');
	content.className = 'message-content';

	let citationHTML = '';
	if (sender === 'bot' && citation && citation.length > 0) {
		citationHTML = citation.map(c => {
			const pageLabel = c.page ? ` · p.${c.page}` : '';
			const icon = getSourceIcon(c.name);
			const safeName = (c.name || '').replace(/'/g, "\\'");

			// Skip video/lecture link sources
			if (/video links|lecture video/i.test(c.name || '')) return '';

			// Textbook — show local page image
			const isTextbook = /college physics|textbook|physics.?2e/i.test(c.name || '');
			if (isTextbook && c.page) {
				return `<span class="citation-pill" onclick="showBookRef(${c.page})" style="cursor:pointer" title="View page ${c.page}">${icon} ${c.name}${pageLabel}</span>`;
			}

			// Everything else (slides, notes, YouTube) — open from Google Drive
			if (c.drive_file_id) {
				const driveUrl = `https://drive.google.com/file/d/${c.drive_file_id}/preview${c.page ? `#page=${c.page}` : ''}`;
				return `<span class="citation-pill" onclick="showDriveRef('${driveUrl}','${safeName}',${c.page||'null'})" style="cursor:pointer" title="View source">${icon} ${c.name}${pageLabel}</span>`;
			}

			// Video with URL but no drive ID — skip
			if (c.url) return '';

			// Fallback — show text content
			if (c.text) {
				const safeText = c.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
				return `<span class="citation-pill" onclick="showTextRef('${safeText}','${safeName}',${c.page||1})" style="cursor:pointer" title="View source">${icon} ${c.name}${pageLabel}</span>`;
			}

			if (!c.name) return '';
			return `<span class="citation-pill" title="Source reference">${icon} ${c.name}${pageLabel}</span>`;
		}).join('');
	}

	// Extract inline image markers ([IMAGE:data:...]) before HTML rendering
	const inlineImages = [];
	let textWithoutImages = displayText.replace(/\[IMAGE:(data:[^\]]+)\]/g, (_, dataUrl) => {
		inlineImages.push(dataUrl);
		return '';
	});

	content.innerHTML = textWithoutImages
	.replace(/\n/g, '<br>')
	.replace(/<https?:\/\/[^>]+>/g, (match) => {
		const url = match.slice(1, -1);
		return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
	});

	// Render any persisted images (shown when replaying history)
	if (inlineImages.length > 0) {
		const imagesDiv = document.createElement('div');
		imagesDiv.className = 'message-inline-images';
		imagesDiv.style.cssText = 'margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;';
		inlineImages.forEach(dataUrl => {
			const img = document.createElement('img');
			img.src = dataUrl;
			img.style.cssText = 'max-width: 220px; max-height: 180px; border-radius: 6px; border: 1px solid #ddd; cursor: pointer; object-fit: contain;';
			img.title = 'Click to view full size';
			img.onclick = () => {
				const modal = document.createElement('div');
				modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;';
				const fullImg = document.createElement('img');
				fullImg.src = dataUrl;
				fullImg.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;';
				modal.appendChild(fullImg);
				modal.onclick = () => modal.remove();
				document.body.appendChild(modal);
			};
			imagesDiv.appendChild(img);
		});
		content.appendChild(imagesDiv);
	}

	if (citationHTML) {
		const pill = document.createElement('div');
		pill.className = 'citation-wrap';
		pill.innerHTML = citationHTML;
		content.appendChild(pill);
	}


	if (files && files.length > 0) {
		const filesDiv = document.createElement('div');
		filesDiv.className = 'message-files';
		filesDiv.style.cssText = 'margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;';

		files.forEach((file) => {
			const fileSpan = document.createElement('span');
			fileSpan.className = 'message-file';
			fileSpan.style.cssText =
				'background: #e3f2fd; padding: 4px 8px; border-radius: 12px; font-size: 12px; cursor: pointer; color: #1976d2;';
			fileSpan.innerHTML = `${getFileIcon(file.type)} ${file.name}`;
			fileSpan.onclick = () => viewUploadedFile(file);
			filesDiv.appendChild(fileSpan);
		});

		content.appendChild(filesDiv);
	}

	messageDiv.appendChild(avatar);
	messageDiv.appendChild(content);
	chatMessages.appendChild(messageDiv);
	chatMessages.scrollTop = chatMessages.scrollHeight;

	// Render LaTeX math in this message using KaTeX
	if (sender === 'bot') {
		const renderKatex = () => {
			if (window.renderMathInElement) {
				renderMathInElement(content, {
					delimiters: [
						{ left: '$$', right: '$$', display: true },
						{ left: '$',  right: '$',  display: false },
						{ left: '\\(', right: '\\)', display: false },
						{ left: '\\[', right: '\\]', display: true }
					],
					throwOnError: false,
					output: 'html'
				});
				chatMessages.scrollTop = chatMessages.scrollHeight;
			}
		};
		// KaTeX scripts are deferred — wait for them if not yet ready
		if (window.renderMathInElement) {
			renderKatex();
		} else {
			window.addEventListener('load', renderKatex, { once: true });
		}
	}

	if (window.sessionManager && window.sessionManager.sessionId) {
		window.sessionManager.broadcastMessage(text, sender, files);
	}

	// Persist to MongoDB (skip when replaying history)
	if (!silent && window.chatHistoryManager) {
		const userName = (window.sessionManager && window.sessionManager.userName) || '';
		// For user messages with images, embed image data URLs inline so they
		// are visible when the conversation is loaded from history.
		let contentToStore = text;
		if (sender === 'user' && files && files.length > 0) {
			const imageTags = files
				.filter(f => f.type && f.type.startsWith('image/') && f.data)
				.map(f => `\n[IMAGE:${f.data}]`)
				.join('');
			if (imageTags) contentToStore = text + imageTags;
		}
		window.chatHistoryManager.appendMessage(sender === 'bot' ? 'bot' : 'user', contentToStore, userName);
	}

}

function viewUploadedFile(file) {
	if (file.data) {
		const modal = document.createElement('div');
		modal.className = 'file-viewer-modal';
		modal.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: rgba(0,0,0,0.8);
			z-index: 10000;
			display: flex;
			align-items: center;
			justify-content: center;
		`;

		const content = document.createElement('div');
		content.style.cssText = `
			background: white;
			border-radius: 8px;
			max-width: 90%;
			max-height: 90%;
			overflow: auto;
			position: relative;
		`;

		const closeBtn = document.createElement('button');
		closeBtn.innerHTML = '×';
		closeBtn.style.cssText = `
			position: absolute;
			top: 10px;
			right: 15px;
			background: none;
			border: none;
			font-size: 24px;
			cursor: pointer;
			z-index: 1;
		`;
		closeBtn.onclick = () => modal.remove();

		if (file.type.startsWith('image/')) {
			const img = document.createElement('img');
			img.src = file.data;
			img.style.cssText = 'max-width: 100%; max-height: 100%; display: block;';
			content.appendChild(img);
		} else if (file.type === 'application/pdf') {
			const iframe = document.createElement('iframe');
			iframe.src = file.data;
			iframe.style.cssText = 'width: 80vw; height: 80vh; border: none;';
			content.appendChild(iframe);
		}

		content.appendChild(closeBtn);
		modal.appendChild(content);
		document.body.appendChild(modal);

		modal.onclick = (e) => {
			if (e.target === modal) modal.remove();
		};
	}
}

let loadingInterval;
let loadingStartTime;
let isLoadingActive = false;

function showLoading() {
	// Clear any existing loading first
	if (loadingInterval) {
		clearInterval(loadingInterval);
		loadingInterval = null;
	}
	
	// Prevent multiple loading instances
	if (isLoadingActive) return;
	
	const loadingIndicator = document.getElementById('loadingIndicator');
	const progressFill = document.getElementById('progressFill');
	const loadingMessage = document.getElementById('loadingMessage');
	const loadingTime = document.getElementById('loadingTime');
	
	if (loadingIndicator) {
		isLoadingActive = true;
		loadingIndicator.style.display = 'flex';
		
		// Reset progress
		if (progressFill) progressFill.style.width = '0%';
		
		// Set initial message
		if (loadingMessage) loadingMessage.textContent = 'Tutor is thinking...';
		if (loadingTime) loadingTime.textContent = 'Estimated time: 5 seconds';
		
		// Start progress animation
		startProgressAnimation();
	}
}

function hideLoading() {
	const loadingIndicator = document.getElementById('loadingIndicator');
	if (loadingIndicator) {
		loadingIndicator.style.display = 'none';
	}
	
	// Clear interval and reset state
	if (loadingInterval) {
		clearInterval(loadingInterval);
		loadingInterval = null;
	}
	isLoadingActive = false;
}

function startProgressAnimation() {
	const progressFill = document.getElementById('progressFill');
	const loadingMessage = document.getElementById('loadingMessage');
	const loadingTime = document.getElementById('loadingTime');
	
	let progress = 0;
	let messageIndex = 0;
	let timeRemaining = 5;
	let tickCount = 0;
	
	const messages = [
		'Tutor is thinking...',
		'Analyzing your question...',
		'Searching knowledge base...',
		'Preparing explanation...',
		'Almost ready...'
	];
	
	loadingInterval = setInterval(() => {
		tickCount++;
		
		// Update progress
		if (progress < 70) {
			progress += Math.random() * 8 + 2;
		} else if (progress < 90) {
			progress += Math.random() * 3 + 1;
		} else {
			progress += Math.random() * 1;
		}
		
		progress = Math.min(progress, 95);
		
		if (progressFill) {
			progressFill.style.width = progress + '%';
		}
		
		// Update message every 7 ticks (1.4 seconds)
		if (tickCount % 7 === 0 && messageIndex < messages.length - 1) {
			messageIndex++;
			if (loadingMessage) {
				loadingMessage.textContent = messages[messageIndex];
			}
		}
		
		// Update countdown every 5 ticks (1 second)
		if (tickCount % 5 === 0 && timeRemaining > 0) {
			timeRemaining--;
		}
		
		if (loadingTime) {
			if (timeRemaining > 0) {
				loadingTime.textContent = `Estimated time: ${timeRemaining} seconds`;
			} else {
				loadingTime.textContent = 'Just a moment...';
			}
		}
		
	}, 200);
}

function showLoadingForQuiz() {
	if (loadingInterval) {
		clearInterval(loadingInterval);
		loadingInterval = null;
	}

	const loadingIndicator = document.getElementById('loadingIndicator');
	const progressFill = document.getElementById('progressFill');
	const loadingMessage = document.getElementById('loadingMessage');
	const loadingTime = document.getElementById('loadingTime');
	
	if (loadingIndicator) {
		loadingIndicator.style.display = 'flex';
		loadingStartTime = Date.now();
		
		// Reset progress
		if (progressFill) progressFill.style.width = '0%';
		
		// Set quiz-specific messages
		if (loadingMessage) loadingMessage.textContent = 'Generating quiz questions...';
		if (loadingTime) loadingTime.textContent = 'Estimated time: 8-12 seconds';
		
		// Start quiz-specific progress animation
		startQuizProgressAnimation();
	}
}

function startQuizProgressAnimation() {
	const progressFill = document.getElementById('progressFill');
	const loadingMessage = document.getElementById('loadingMessage');
	const loadingTime = document.getElementById('loadingTime');
	
	let progress = 0;
	let messageIndex = 0;
	
	const quizMessages = [
		'Generating quiz questions...',
		'Creating multiple choice options...',
		'Reviewing question difficulty...',
		'Finalizing quiz content...',
		'Almost ready...'
	];
	
	loadingInterval = setInterval(() => {
		const elapsed = (Date.now() - loadingStartTime) / 1000;
		
		// Slower progress for quiz generation
		if (progress < 60) {
			progress += Math.random() * 4 + 1;
		} else if (progress < 85) {
			progress += Math.random() * 2 + 0.5;
		} else {
			progress += Math.random() * 0.5;
		}
		
		progress = Math.min(progress, 95);
		
		if (progressFill) {
			progressFill.style.width = progress + '%';
		}
		
		// Update message every 2 seconds for quiz
		if (Math.floor(elapsed / 2) > messageIndex && messageIndex < quizMessages.length - 1) {
			messageIndex++;
			if (loadingMessage) {
				loadingMessage.textContent = quizMessages[messageIndex];
			}
		}
		
		// Update time estimation for quiz
		if (loadingTime) {
			const remaining = Math.max(0, 12 - elapsed);
			if (remaining > 1) {
				loadingTime.textContent = `Estimated time: ${Math.ceil(remaining)} seconds`;
			} else {
				loadingTime.textContent = 'Just a moment...';
			}
		}
		
	}, 300);
}

function completeLoading() {
	const progressFill = document.getElementById('progressFill');
	const loadingMessage = document.getElementById('loadingMessage');
	
	if (progressFill) {
		progressFill.style.width = '100%';
	}
	
	if (loadingMessage) {
		loadingMessage.textContent = 'Ready!';
	}
	
	setTimeout(() => {
		hideLoading();
	}, 500);
}

// Make function globally available
window.showLoadingForQuiz = showLoadingForQuiz;
window.addMessage = addMessage;
function hasWhiteboardContent(board) {
	const canvas = board === 'teacher' ? 
		document.getElementById('teacherWhiteboard') : 
		document.getElementById('studentWhiteboard');
	if (!canvas) return false;
	
	const ctx = canvas.getContext('2d');
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const data = imageData.data;
	
	// Check if any non-white pixels exist
	for (let i = 0; i < data.length; i += 4) {
		if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
			return true;
		}
	}
	return false;
}

async function getOcrTextFromWhiteboardImage(board) {
	try {
		const canvas =
			board === 'teacher' ? document.getElementById('teacherWhiteboard') : document.getElementById('studentWhiteboard');
		if (!canvas) {
			return null;
		}

		const base64Image = canvas.toDataURL('image/png');
		const text = await getOcrFromImage(base64Image);
		return text;
	} catch (err) {
		return null;
	}
}

async function searchPhysicsTextbook(query) {
	// Check cache first
	const cacheKey = query.toLowerCase().trim();
	if (searchCache.has(cacheKey)) {
		return searchCache.get(cacheKey);
	}
	
	try {
		// Search web pages, PDFs, and Pinecone in parallel
		const [webRes, pdfRes, pineconeRes] = await Promise.all([
			fetch('/api/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query })
			}),
			fetch('/api/pdf-content', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query })
			}),
			fetch('/api/pinecone', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query })
			}).catch(() => null)
		]);

		let results = [];
		
		if (webRes.ok) {
			const webData = await webRes.json();
			results = webData.results || [];
		}
		
		if (pdfRes.ok) {
			const pdfData = await pdfRes.json();
			const pdfResults = (pdfData.pdfs || []).map(pdf => ({
				title: pdf.title,
				link: pdf.url,
				pageNumber: pdf.pageNumber,
				snippet: pdf.snippet,
				content: pdf.content
			}));
			results = [...results, ...pdfResults];
		}

		if (pineconeRes && pineconeRes.ok) {
			const pineconeData = await pineconeRes.json();
			const pineconeResults = (pineconeData.chunks || []).map(chunk => ({
				title: chunk.source,
				link: chunk.url || chunk.source,
				pageNumber: chunk.page,
				snippet: chunk.text.substring(0, 200),
				content: chunk.text,
				url: chunk.url,
				embed_url: chunk.embed_url,
				drive_file_id: chunk.drive_file_id,
				file_name: chunk.file_name,
				type: chunk.type,
				fromPinecone: true
			}));
			results = [...pineconeResults, ...results];
		}
		
		// Cache results (limit cache size)
		if (searchCache.size > 50) {
			const firstKey = searchCache.keys().next().value;
			searchCache.delete(firstKey);
		}
		searchCache.set(cacheKey, results);
		
		return results;
	} catch (err) {
		return [];
	}
}

// ── In-class history loader ──────────────────────────────────────────────────
// Fetches all stored messages for this session from the in-class DB and
// injects them into the AI context so the tutor knows every prior exchange.
// Called once per session (guarded by window._inClassHistoryLoaded).
async function loadInClassHistory() {
	window._inClassHistoryLoaded = true; // set early to prevent concurrent calls

	// Use the live session ID from sessionManager (the _inClassSessionId window
	// var is cleared after join, so we read from sessionManager here)
	const sessionId = window.sessionManager && window.sessionManager.sessionId;
	if (!sessionId || !window._inClassMode) return;

	const BACKEND = 'https://physics-ai-tutor.onrender.com';
	try {
		const res = await fetch(`${BACKEND}/api/in-class/chat?sessionId=${encodeURIComponent(sessionId)}`);
		if (!res.ok) return;
		const convos = await res.json();
		if (!convos || convos.length === 0) return;

		// Fetch each conversation's full messages in parallel
		const allMessages = [];
		await Promise.all(convos.map(async (convo) => {
			try {
				const fullRes = await fetch(`${BACKEND}/api/in-class/chat/${convo._id}`);
				if (!fullRes.ok) return;
				const full = await fullRes.json();
				(full.messages || []).forEach(m => {
					allMessages.push({
						ts: new Date(m.timestamp).getTime(),
						role: m.role,
						content: m.content,
						userName: m.userName || '',
					});
				});
			} catch (_) {}
		}));

		if (allMessages.length === 0) return;

		// Sort chronologically
		allMessages.sort((a, b) => a.ts - b.ts);

		const historyText = allMessages
			.map(m => {
				const who = m.role === 'bot' ? 'AI Tutor' : (m.userName || 'Student');
				return `${who}: ${m.content}`;
			})
			.join('\n');

		// Insert history right after the system prompt (index 0)
		context.splice(1, 0, {
			role: 'system',
			content: `PREVIOUS CONVERSATION HISTORY for this in-class session (${window._inClassSessionTitle || sessionId}).\nUse this to understand what each student has already discussed so you can build on it and avoid repeating yourself:\n\n${historyText.substring(0, 6000)}\n\n--- End of history ---`,
		});

		console.log(`[in-class] Injected ${allMessages.length} historical messages into context`);
	} catch (e) {
		console.warn('[in-class] Failed to load history:', e.message);
		window._inClassHistoryLoaded = false; // allow retry on next message
	}
}

async function processUserMessage(message) {
	if (isProcessing || (!message.trim() && uploadedFiles.length === 0)) return;

	// Check if this is a quiz request before processing
	if (window.quizIntegration && window.quizIntegration.handleQuizCommands(message)) {
		return; // Quiz command handled, don't process further
	}

	isProcessing = true;

	// Process uploaded files if any
	let processedFiles = [];
	let fileData = [];
	if (uploadedFiles.length > 0) {
		try {
			processedFiles = await processFilesForTutor(uploadedFiles);
			fileData = processedFiles;
		} catch (fileError) {
			addMessage('Error processing files. Continuing without files.', 'bot');
		}
		// Clear uploaded files after processing
		uploadedFiles = [];
		const filePreview = document.getElementById('filePreview');
		filePreview.innerHTML = '';
		filePreview.style.display = 'none';
	}

	// Detect if any of the uploaded files are images
	const hasImages = processedFiles.some(f => f.type && f.type.startsWith('image/'));

	// Prepare user message (include file info if files were uploaded)
	let userMessage = message.trim();
	if (processedFiles.length > 0) {
		if (hasImages && !userMessage) {
			// No text provided — give Gemini something to work with in adversarial mode
			userMessage = 'I uploaded an image. Please look at it carefully and engage with it as my physics tutor.';
		} else if (!userMessage) {
			const fileNames = processedFiles.map((f) => f.name).join(', ');
			userMessage = `I've uploaded these files: ${fileNames}`;
		}
		// Files (with base64 data) are sent directly to Gemini API
	}

	// Handle message display/broadcasting (only once!)
	if (window.sessionManager && window.sessionManager.sessionId) {
		// In session mode, broadcast user message
		window.sessionManager.broadcastMessage(userMessage, 'user', fileData);
	} else {
		// Not in session, add message locally
		addMessage(userMessage, 'user', fileData);
	}

	// Always process with AI regardless of session mode
	// This ensures the AI responds to all user messages in sessions

	showLoading();

	try {
		let boardToCheck = 'student'; //hard-coded to student board only.
		// if (/student board|student whiteboard/i.test(message)) {
		// 	boardToCheck = 'student';
		// } else if (/teacher board|teacher whiteboard/i.test(message)) {
		// 	boardToCheck = 'teacher';
		// }

		// At-home mode: capture the whiteboard as an actual image and inject it
		// into processedFiles so Gemini sees it visually — identical to how
		// in-class mode works via sendWhiteboardToTutor.
		if (!window.sessionManager?.sessionId && boardToCheck && hasWhiteboardContent(boardToCheck)) {
			try {
				const srcCanvas = document.getElementById(
					boardToCheck === 'teacher' ? 'teacherWhiteboard' : 'studentWhiteboard'
				);

				if (srcCanvas) {
					// Build composite: white background + canvas strokes + stickers
					const snap = document.createElement('canvas');
					snap.width  = srcCanvas.width;
					snap.height = srcCanvas.height;
					const snapCtx = snap.getContext('2d');

					snapCtx.fillStyle = '#ffffff';
					snapCtx.fillRect(0, 0, snap.width, snap.height);
					snapCtx.drawImage(srcCanvas, 0, 0);

					// Composite any placed stickers from the overlay
					const overlay = document.getElementById('stickerOverlay');
					const stickerPromises = [];
					if (overlay) {
						overlay.querySelectorAll('.placed-sticker').forEach(el => {
							const img = el.querySelector('img');
							if (!img || !img.complete) return;
							const left = parseInt(el.style.left) || 0;
							const top  = parseInt(el.style.top)  || 0;
							const w    = el.offsetWidth  || parseInt(el.style.width)  || 80;
							const h    = el.offsetHeight || parseInt(el.style.height) || 80;
							if (img.naturalWidth === 0) {
								stickerPromises.push(new Promise(resolve => {
									img.onload = () => { snapCtx.drawImage(img, left, top, w, h); resolve(); };
								}));
							} else {
								snapCtx.drawImage(img, left, top, w, h);
							}
						});
					}
					await Promise.all(stickerPromises);

					// Convert to base64 and prepend to processedFiles so Gemini
					// receives the whiteboard image alongside the user's message.
					const base64 = snap.toDataURL('image/png');
					processedFiles.unshift({
						name: 'student-whiteboard.png',
						type: 'image/png',
						data: base64,          // must match the 'data' field the server expects
						size: Math.round(base64.length * 0.75)
					});

					// If the user typed nothing, give Gemini a useful default prompt
					if (!userMessage.trim()) {
						userMessage = 'Here is my whiteboard. Can you look at my work and help me understand if it\'s correct?';
					} else {
						userMessage = userMessage + ' [Student whiteboard attached]';
					}
				}
			} catch (wbErr) {
				// Fall back silently — the message still goes through without the image
				console.warn('[whiteboard capture]', wbErr);
			}
		} else if (boardToCheck && hasWhiteboardContent(boardToCheck)) {
			// In-class session: OCR path is still used (session handles image via sendWhiteboardToTutor)
			const ocrText = await getOcrTextFromWhiteboardImage(boardToCheck);
			if (ocrText && ocrText.trim() && ocrText.trim().toLowerCase() !== 'error reading image text.') {
				context.push({
					role: 'user',
					content: `${boardToCheck} has the text: ${ocrText}`
				});
			}
		}

		// Add user message to context for AI
		if (window.sessionManager && window.sessionManager.sessionId) {
			// In-class shared session:
			// 1. On first message, inject full DB history into context (once)
			// 2. Flush any messages received from other clients via WebSocket
			// 3. Append the current message
			if (!window._inClassHistoryLoaded) {
				await loadInClassHistory();
			}
			// Flush pending context updates from other students' messages
			if (window._pendingContextUpdate && window._pendingContextUpdate.length > 0) {
				window._pendingContextUpdate.forEach(entry => context.push(entry));
				window._pendingContextUpdate = [];
			}
		}

		// Build a context-safe description of any uploaded files so future turns
		// remember what was in the image (the binary is only sent once to Gemini).
		let fileContextSuffix = '';
		if (processedFiles.length > 0) {
			const fileParts = processedFiles.map(f => {
				if (f.type && f.type.startsWith('image/')) {
					const ocrNote = f.ocrText
						? `\n[Extracted text from image: ${f.ocrText.slice(0, 800)}]`
						: '';
					return `[Student uploaded an image: ${f.name}]${ocrNote}`;
				}
				return `[Student attached a file: ${f.name} (${f.type})]`;
			});
			fileContextSuffix = '\n' + fileParts.join('\n');
		}

		// Append current message to context
		if (window.sessionManager?.sessionId) {
			context.push({ role: 'user', content: `${window.sessionManager.userName}: ${userMessage}${fileContextSuffix}` });
		} else {
			// Not in session — just add current message
			context.push({ role: 'user', content: `${userMessage}${fileContextSuffix}` });
		}
		// Search for matching physics textbook sections
		const searchResults = await searchPhysicsTextbook(userMessage || message);

		// Build a url lookup map: source name -> url (for YouTube links)
		const sourceUrlMap = {};
		searchResults.forEach(r => { if (r.url) sourceUrlMap[r.title] = r.url; });

		if (searchResults.length > 0) {
			const pineconeChunks = searchResults.filter(r => r.fromPinecone);
			const textbookChunks = searchResults.filter(r => !r.fromPinecone);

			let refsText = 'COURSE MATERIALS — use these as your primary reference:\n';

			pineconeChunks.forEach((r, idx) => {
				refsText += `${idx + 1}. Source: ${r.title}${r.pageNumber ? ` | Page ${r.pageNumber}` : ''}\n${r.content.substring(0, 800)}\n\n`;
			});

			textbookChunks.forEach((r, idx) => {
				const label = r.title || 'College Physics 2e';
				const page = r.pageNumber ? ` | Page ${r.pageNumber}` : '';
				refsText += `${pineconeChunks.length + idx + 1}. Source: ${label}${page}\n${(r.content || r.snippet || '').substring(0, 500)}\n\n`;
			});

			refsText += 'Use the above materials to ground your response. Do NOT mention source names or citations in your response text — citations are handled separately.';

			context.push({
				role: 'system',
				content: refsText
			});

		}

	// ── S-DO mode logic (PRE-CALL) ──────────────────────────────────────────
	// Detect the student's choice BEFORE calling Gemini so the API call uses
	// the right system prompt and the right instruction.
	// When the student replies "D" we DON'T want Gemini to answer "D" in
	// Socratic mode — we want a full didactic explanation of the ORIGINAL problem.
	let didacticTrigger = false;
	if (teachingMode === 'pending_choice') {
		const reply = userMessage.trim().toUpperCase();
		if (reply === 'D') {
			didacticTrigger = true;
			teachingMode = 'didactic';
			context[0] = { role: 'system', content: getSystemPrompt() };

			// 1. Strip the S-DO offer text from the last assistant message in context
			//    so Gemini doesn't see it as a pattern to repeat.
			const SDO_PATTERN = /\*\*You've clearly put real effort[\s\S]*?step by step \(reply "S"\)\?\*\*/g;
			for (let i = context.length - 1; i >= 0; i--) {
				if (context[i].role === 'assistant') {
					context[i] = { role: 'assistant', content: context[i].content.replace(SDO_PATTERN, '').trim() };
					break;
				}
			}

			// 2. Append a didactic instruction to the last user message rather than
			//    replacing it — this preserves any image/file context already there.
			const lastUserIdx = [...context].map((m, i) => ({ m, i }))
				.filter(({ m }) => m.role === 'user')
				.at(-1)?.i;
			if (lastUserIdx !== undefined) {
				context[lastUserIdx] = {
					role: 'user',
					content: context[lastUserIdx].content +
						'\n\n[The student chose Didactic mode. Give a complete, step-by-step solution to the ORIGINAL problem shown/described above. Use the specific numbers and scenario from that problem — do NOT give a generic answer.]'
				};
			}
		} else {
			// 'S' or anything else — stay Socratic, reset counter
			teachingMode = 'socratic';
			exchangeRounds = 0;
			sdoPromptSent = false;
			context[0] = { role: 'system', content: getSystemPrompt() };
		}
	}

	// Reinforce the Socratic rules right before every call (only in Socratic mode)
	if (teachingMode === 'socratic') {
		context.push({
			role: 'system',
			content: `REMINDER — SOCRATIC MODE IS ACTIVE. You MUST follow ALL rules without exception:
• Do NOT give the answer or a full explanation.
• End with exactly ONE focused question that guides the student one step further.
• Build on what the student just said.
• Keep the tone warm and encouraging.
• BANNED: full derivations, complete definitions, giving away the answer.`
		});
	}

	// In didactic mode: remind Gemini NOT to re-append the S-DO choice prompt
	// and to stay focused on the specific problem, not a generic explanation.
	if (teachingMode === 'didactic') {
		context.push({
			role: 'system',
			content: `REMINDER — DIDACTIC MODE IS ACTIVE.
• Give a complete, step-by-step solution using the EXACT numbers and scenario from the original problem.
• Do NOT give a generic textbook explanation — solve THIS specific problem.
• Do NOT append any "reply D / reply S" choice prompt. The student already chose. End your response naturally after the solution.`
		});
	}

		// Get AI response with files (only if files processed successfully)
		let botResponse = await getGeminiResponse(context, processedFiles.length > 0 ? processedFiles : []);

		// Remove the reinforcement message from context after use (it's ephemeral)
		if (context[context.length - 1]?.content?.startsWith('REMINDER — SOCRATIC') ||
		    context[context.length - 1]?.content?.startsWith('REMINDER — DIDACTIC')) {
			context.pop();
		}

		// ── S-DO mode logic ─────────────────────────────────────────────────
		// The pending_choice detection and Gemini call are both handled above (PRE-CALL).
		// Nothing to do here — fall through to round counting.

		// Add bot response to context
		context.push({ role: 'assistant', content: botResponse });

		// ── Round counting & S-DO prompt injection ───────────────────────────
		// Only count rounds while in Socratic mode (don't count choice/didactic rounds)
		if (teachingMode === 'socratic') {
			exchangeRounds++;
			// On the 5th completed round, append the S-DO choice prompt to the bot response
			if (exchangeRounds === 5 && !sdoPromptSent) {
				sdoPromptSent = true;
				teachingMode = 'pending_choice';
				const sdoMessage = "\n\n**You've clearly put real effort into reasoning through this. At this point, would you like me to give you the answer directly (reply \"D\"), or would you prefer me to continue working with you through it step by step (reply \"S\")?**";
				botResponse += sdoMessage;
				// Update the last context entry to include the S-DO prompt
				context[context.length - 1] = { role: 'assistant', content: botResponse };
			}
		} else if (teachingMode === 'didactic') {
			// The didactic explanation has just been delivered.
			// Automatically roll back to Socratic and reset the counter so the
			// cycle starts fresh for the student's next question.
			teachingMode = 'socratic';
			exchangeRounds = 0;
			sdoPromptSent = false;
			context[0] = { role: 'system', content: getSystemPrompt() };

			// Safety net: strip any S-DO offer Gemini still snuck in.
			const SDO_STRIP = /\*\*You've clearly put real effort[\s\S]*?step by step \(reply "S"\)\?\*\*/g;
			botResponse = botResponse.replace(SDO_STRIP, '').trim();
			context[context.length - 1] = { role: 'assistant', content: botResponse };
		}

		// Manage context size
		const maxContextMessages = 18;
		if (context.length > maxContextMessages) {
			context = [context[0], ...context.slice(-(maxContextMessages - 1))];
		}

		// Check for whiteboard actions and diagram generation
		let whiteboardAction = null;
		let targetBoard = null;
		let diagramRequest = null;

		const diagramMatch = botResponse.match(/\[GENERATE_DIAGRAM:\s*([^\]]+)\]/);
		const teacherMatch = botResponse.match(/\[TEACHER_BOARD:\s*([^\]]+)\]/);
		const studentMatch = botResponse.match(/\[STUDENT_BOARD:\s*([^\]]+)\]/);

		if (diagramMatch) {
			diagramRequest = diagramMatch[1].trim();
			targetBoard = 'teacher';
			botResponse = botResponse.replace(/\[GENERATE_DIAGRAM:[^\]]+\]/g, '').trim();
		} else if (teacherMatch) {
			// Convert old syntax to new diagram generation
			diagramRequest = teacherMatch[1].trim();
			targetBoard = 'teacher';
			botResponse = botResponse.replace(/\[TEACHER_BOARD:[^\]]+\]/g, '').trim();
		} else if (studentMatch) {
			whiteboardAction = studentMatch[1];
			targetBoard = 'student';
			botResponse = botResponse.replace(/\[STUDENT_BOARD:[^\]]+\]/g, '').trim();
		}
		
		// Clean up any remaining whiteboard tags
		botResponse = botResponse.replace(/\[(?:TEACHER_BOARD|STUDENT_BOARD|GENERATE_DIAGRAM):[^\]]+\]/g, '').trim();

		// Extract citation BEFORE stripping (before convertLatexToUnicode can turn it into a table)
		// Always use actual Pinecone source names — ignore whatever Gemini wrote
		const extractedCitation = searchResults
			.filter(r => r.fromPinecone)
			.filter((r, i, arr) => arr.findIndex(x => x.title === r.title) === i) // dedupe
			.map(r => ({
				name: r.title,
				page: r.pageNumber || null,
				url: r.url || null,
				embed_url: r.embed_url || null,
				drive_file_id: r.drive_file_id || null,
				file_name: r.file_name || null,
				type: r.type || null,
				text: r.content || r.snippet || null
			}));
		// Strip ALL citation formats before any rendering
		botResponse = botResponse
			.replace(/📖\s*Source:[^\n]*/gi, '')
			.replace(/^[-|\s]+$/gm, '')
			.trim();

		// Process bot response for broken links
		if (window.processBotMessageWithLinkValidation) {
			botResponse = await window.processBotMessageWithLinkValidation(botResponse);
		}

		// Complete loading animation
		completeLoading();
		
		// Handle bot response display/broadcasting
		if (window.sessionManager && window.sessionManager.sessionId) {
			// Stash citations so addSharedMessage can pick them up when the
			// WebSocket echo arrives. Keyed by a hash of the message content.
			window._pendingCitations = window._pendingCitations || [];
			window._pendingCitations.push(extractedCitation);
			// Broadcast — citations travel in the payload so all participants see them
			window.sessionManager.broadcastMessage(botResponse, 'bot', [], extractedCitation);
			// Also save to in-class DB and auto-title from this client
			if (window.chatHistoryManager) {
				window.chatHistoryManager.autoTitle(message, botResponse);
			}
		} else {
			addMessage(botResponse, 'bot', [], extractedCitation);
			// Auto-generate conversation title from the first exchange
			if (window.chatHistoryManager) {
				window.chatHistoryManager.autoTitle(message, botResponse);
			}
		}

		// Execute whiteboard action or generate diagram
		if (diagramRequest && targetBoard) {
			setTimeout(() => generateAIDiagram(diagramRequest, targetBoard), 500);
		} else if (whiteboardAction && targetBoard && window.tutorWhiteboard) {
			setTimeout(() => executeWhiteboardAction(whiteboardAction, targetBoard), 500);
		}
	} catch (error) {

		let errorMessage = 'I apologize, but I encountered an issue. ';

		if (error.message.includes('Cannot reach the API')) {
			errorMessage += 'The API endpoint is not responding. Please check your deployment.';
		} else if (error.message.includes('API endpoint not found')) {
			errorMessage += 'The API endpoint is missing. Make sure /api/gemini.js exists.';
		} else if (error.message.includes('API authentication failed')) {
			errorMessage += 'Please check your GEMINI_API_KEY environment variable.';
		} else if (error.message.includes('Server error')) {
			errorMessage += 'Please check your server logs and API configuration.';
		} else {
			errorMessage += 'Please try again or check the browser console for details.';
		}

		// Add helpful note about textbook references
		errorMessage +=
			'\n\n📚 Note: I can still help explain physics concepts even if College Physics 2e references are temporarily unavailable.';

		// Handle error message display/broadcasting
		if (window.sessionManager && window.sessionManager.sessionId) {
			window.sessionManager.broadcastMessage(errorMessage, 'bot');
		} else {
			addMessage(errorMessage, 'bot');
		}
	}

	// Always hide loading and reset processing state
	if (loadingInterval) {
		clearInterval(loadingInterval);
		loadingInterval = null;
	}
	hideLoading();
	isProcessing = false;
}

function executeWhiteboardAction(actionType, targetBoard) {
	if (!window.tutorWhiteboard) {
		return;
	}



	// ADD THIS: Broadcast whiteboard action to session
	if (window.sessionManager && window.sessionManager.sessionId) {
		window.sessionManager.ws.send(
			JSON.stringify({
				type: 'whiteboard_action',
				action: actionType,
				targetBoard: targetBoard,
				userName: window.sessionManager.userName
			})
		);
	}

	if (window.switchWhiteboard) {
		window.switchWhiteboard(targetBoard);
	}

	switch (actionType) {
		case 'probability_scale':
			if (window.tutorWhiteboard.drawProbabilityScale) {
				window.tutorWhiteboard.drawProbabilityScale(targetBoard);
			}
			break;
		case 'distribution':
			if (window.tutorWhiteboard.drawSampleDistribution) {
				window.tutorWhiteboard.drawSampleDistribution(targetBoard);
			}
			break;
		case 'normal_curve':
			if (window.tutorWhiteboard.drawNormalCurve) {
				window.tutorWhiteboard.drawNormalCurve(targetBoard);
			}
			break;
		case 'tree_diagram':
			if (window.tutorWhiteboard.drawTreeDiagram) {
				window.tutorWhiteboard.drawTreeDiagram(targetBoard);
			}
			break;
		case 'clear_board':
			if (window.tutorWhiteboard.clearWhiteboard) {
				window.tutorWhiteboard.clearWhiteboard(targetBoard);
			}
			break;
		default:
			break;
	}
}

function handleDiceResult(result) {
	const message = `I rolled a ${result}! What does this tell us about probability?`;
	processUserMessage(message);
}
// AI Diagram Generation Function — uses Gemini image generation
async function generateAIDiagram(description, targetBoard = 'teacher') {
	try {
		if (window.switchWhiteboard) window.switchWhiteboard(targetBoard);

		const res = await fetch('/api/image-gen', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: `Clear educational physics diagram: ${description}. White background, labeled, simple and clean.` })
		});
		const data = await res.json();
		if (!res.ok || !data.image) throw new Error(data.error || 'No image returned');

		const canvas = targetBoard === 'teacher'
			? document.getElementById('teacherWhiteboard')
			: document.getElementById('studentWhiteboard');
		if (!canvas) throw new Error('Canvas not found');

		const ctx = canvas.getContext('2d');
		const img = new Image();
		img.onload = () => {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
			const x = (canvas.width - img.width * scale) / 2;
			const y = (canvas.height - img.height * scale) / 2;
			ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
		};
		img.src = data.image;

		if (window.sessionManager && window.sessionManager.sessionId && window.sessionManager.ws) {
			window.sessionManager.ws.send(JSON.stringify({
				type: 'diagram_generated',
				description,
				targetBoard,
				userName: window.sessionManager.userName
			}));
		}
	} catch (error) {
		addMessage('Sorry, I had trouble generating the diagram. Let me explain in text instead.', 'bot');
	}
}

function saveChatHistory() {
	if (!window.jspdf) {
		alert('PDF library not loaded yet. Please try again in a moment.');
		return;
	}

	const { jsPDF } = window.jspdf;
	const doc = new jsPDF();

	const pageWidth  = doc.internal.pageSize.width;
	const pageHeight = doc.internal.pageSize.height;
	const margin     = 15;
	const maxWidth   = pageWidth - margin * 2;
	let y            = 20;

	// ── Header ──────────────────────────────────────────────────────────────
	doc.setFillColor(136, 28, 28);          // maroon
	doc.rect(0, 0, pageWidth, 28, 'F');

	doc.setTextColor(255, 255, 255);
	doc.setFontSize(16);
	doc.setFont(undefined, 'bold');
	doc.text('Physics 131 — Tutor Chat Notes', margin, 18);
	y = 36;

	// Date subtitle
	doc.setTextColor(100, 100, 100);
	doc.setFontSize(9);
	doc.setFont(undefined, 'normal');
	doc.text(`Saved: ${new Date().toLocaleString()}`, margin, y);
	y += 10;

	// Divider
	doc.setDrawColor(220, 220, 220);
	doc.line(margin, y, pageWidth - margin, y);
	y += 8;

	// ── Messages ────────────────────────────────────────────────────────────
	const messages = document.querySelectorAll('.message');

	messages.forEach((message) => {
		const isBot    = message.classList.contains('bot-message');
		const label    = isBot ? 'Tutor' : 'Student';
		const rawText  = message.querySelector('.message-content')?.innerText || '';

		// Label pill colour
		if (isBot) {
			doc.setFillColor(136, 28, 28);   // maroon for tutor
		} else {
			doc.setFillColor(30, 100, 200);  // blue for student
		}

		// Label
		doc.setFontSize(9);
		doc.setFont(undefined, 'bold');
		doc.setTextColor(255, 255, 255);
		doc.roundedRect(margin, y - 4, 22, 7, 2, 2, 'F');
		doc.text(label, margin + 2, y + 1);

		y += 9;

		// Body text
		doc.setTextColor(30, 30, 30);
		doc.setFontSize(10);
		doc.setFont(undefined, 'normal');

		const lines = doc.splitTextToSize(rawText.trim(), maxWidth);
		lines.forEach((line) => {
			if (y > pageHeight - 20) {
				doc.addPage();
				y = 20;
			}
			doc.text(line, margin, y);
			y += 5.5;
		});

		// Check for inline images saved in the DOM
		message.querySelectorAll('.message-inline-images img').forEach((img) => {
			try {
				const imgWidth  = maxWidth;
				const imgHeight = Math.min(80, imgWidth * (img.naturalHeight / (img.naturalWidth || 1)));
				if (y + imgHeight > pageHeight - 20) { doc.addPage(); y = 20; }
				doc.addImage(img.src, 'PNG', margin, y, imgWidth, imgHeight);
				y += imgHeight + 4;
			} catch (_) { /* skip unrenderable images */ }
		});

		y += 6;  // gap between messages

		// Page break guard
		if (y > pageHeight - 20) { doc.addPage(); y = 20; }
	});

	const dateStr = new Date().toISOString().slice(0, 10);
	doc.save(`physics-131-notes-${dateStr}.pdf`);
}

async function generateChatSummary() {
	if (isProcessing) return;

	const messages = document.querySelectorAll('.message');
	if (messages.length <= 1) {
		addMessage('No chat history to summarize yet!', 'bot');
		return;
	}

	isProcessing = true;
	showLoading();

	try {
		let chatContent = '';
		messages.forEach((message) => {
			const isBot = message.classList.contains('bot-message');
			const content = message.querySelector('.message-content').textContent;
			const sender = isBot ? 'Tutor' : 'Student';
			chatContent += `${sender}: ${content}\n`;
		});

		const summaryPrompt = `Please provide a concise summary of this tutoring session, highlighting the main topics discussed, key concepts learned, and any problems solved:\n\n${chatContent}`;

		const summaryResponse = await getGeminiResponse([
			{ role: 'system', content: 'You are summarizing a tutoring session. Be concise and focus on learning outcomes.' },
			{ role: 'user', content: summaryPrompt }
		]);

		addMessage(`📋 **Chat Summary:**\n\n${summaryResponse}`, 'bot');
	} catch (error) {
		addMessage('Sorry, I encountered an issue generating the summary. Please try again.', 'bot');
	}

	hideLoading();
	isProcessing = false;
}

// Global function for whiteboard OCR integration
window.addOcrMessageToChat = function (ocrText, boardType) {
	const message = `I wrote on the ${boardType} whiteboard: "${ocrText}"`;

	// Add to chat input
	const chatInput = document.getElementById('chatInput');
	if (chatInput) {
		const currentValue = chatInput.value || '';
		const newValue = currentValue ? `${currentValue}\n\n${message}` : message;
		chatInput.value = newValue;

		// Trigger events
		chatInput.dispatchEvent(new Event('input', { bubbles: true }));
		chatInput.dispatchEvent(new Event('change', { bubbles: true }));

		// Auto-send if possible
		setTimeout(() => {
			if (!isProcessing) {
				handleSendMessage();
			}
		}, 100);
	}
};

function getSourceIcon(sourceName) {
	if (!sourceName) return '📖';
	const s = sourceName.toLowerCase();
	if (s.includes('youtube') || s.includes('video') || s.includes('lecture video')) return '🎬';
	if (s.includes('slide') || s.includes('ppt')) return '🖥️';
	if (s.includes('textbook') || s.includes('book') || s.includes('college physics')) return '📚';
	if (s.includes('note') || s.includes('summary') || s.includes('review')) return '📝';
	if (s.includes('problem') || s.includes('exercise') || s.includes('hw') || s.includes('homework')) return '✏️';
	if (s.includes('exam') || s.includes('quiz') || s.includes('test') || s.includes('midterm') || s.includes('final')) return '📋';
	if (s.includes('lab') || s.includes('experiment')) return '🔬';
	if (s.includes('lecture') || s.includes('class') || s.includes('lec')) return '🎫';
	return '📄';
}

let _pdfCurrentPage = 1;
let _pdfTotalPages = 0;

function showMediaRef(embedUrl, sourceName, mediaType, page) {
	const existing = document.getElementById('textRefOverlay');
	if (existing) existing.remove();

	const overlay = document.createElement('div');
	overlay.id = 'textRefOverlay';
	overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center';

	const panel = document.createElement('div');
	panel.style.cssText = 'width:860px;max-width:95vw;height:560px;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.45);background:#111';

	const header = document.createElement('div');
	header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#014148;color:white;font-size:13px;font-weight:600;flex-shrink:0';
	const pageLabel = page ? ` · p.${page}` : '';
	header.innerHTML = `<span>${getSourceIcon(sourceName)} ${sourceName}${pageLabel}</span>`;

	const closeBtn = document.createElement('button');
	closeBtn.innerHTML = '×';
	closeBtn.style.cssText = 'background:none;border:none;color:white;font-size:20px;cursor:pointer;line-height:1;padding:0 4px';
	closeBtn.onclick = () => overlay.remove();
	header.appendChild(closeBtn);

	const iframe = document.createElement('iframe');
	iframe.src = embedUrl;
	iframe.style.cssText = 'flex:1;border:none;width:100%';
	iframe.allow = 'autoplay; encrypted-media';
	iframe.allowFullscreen = true;

	panel.appendChild(header);
	panel.appendChild(iframe);
	overlay.appendChild(panel);
	document.body.appendChild(overlay);
	overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}
window.showMediaRef = showMediaRef;

function showTextRef(text, sourceName, page) {
	const existing = document.getElementById('textRefOverlay');
	if (existing) existing.remove();

	const overlay = document.createElement('div');
	overlay.id = 'textRefOverlay';
	overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center';

	const panel = document.createElement('div');
	panel.style.cssText = 'width:640px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.45);background:#f8f9fa';

	const header = document.createElement('div');
	header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#014148;color:white;font-size:13px;font-weight:600';
	header.innerHTML = `<span>${getSourceIcon(sourceName)} ${sourceName}${page ? ` · p.${page}` : ''}</span>`;

	const closeBtn = document.createElement('button');
	closeBtn.innerHTML = '×';
	closeBtn.style.cssText = 'background:none;border:none;color:white;font-size:20px;cursor:pointer;line-height:1;padding:0 4px';
	closeBtn.onclick = () => overlay.remove();
	header.appendChild(closeBtn);

	const body = document.createElement('div');
	body.style.cssText = 'flex:1;overflow-y:auto;padding:20px 24px;background:#fff;font-size:14px;line-height:1.8;color:#222;white-space:pre-wrap;font-family:Georgia,serif';
	body.textContent = text;

	panel.appendChild(header);
	panel.appendChild(body);
	overlay.appendChild(panel);
	document.body.appendChild(overlay);
	overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}
window.showTextRef = showTextRef;

async function showBookRef(pageNumber) {
	const overlay = document.getElementById('bookRefOverlay');
	const label = document.getElementById('bookRefPageLabel');
	const title = document.getElementById('bookRefTitle');
	const nav = document.getElementById('bookRefNav');
	const iframe = document.getElementById('bookRefIframe');
	if (!overlay) return;

	overlay.style.display = 'flex';
	if (nav) nav.style.display = 'flex';
	if (iframe) { iframe.src = ''; iframe.style.display = 'none'; }
	if (title) title.textContent = '\uD83D\uDCD6 College Physics 2e';
	_pdfCurrentPage = pageNumber;

	const textDiv = getOrCreateTextDiv();
	textDiv.innerHTML = '<p style="color:#aaa;text-align:center;padding:40px">Loading page...</p>';

	// Format page number with leading zeros to match pdftoppm output (e.g. page-0203.png)
	const padded = String(pageNumber).padStart(4, '0');
	const imgUrl = `https://physics-ai-tutor.onrender.com/api/pdf-image?page=${pageNumber}`;

	const img = new Image();
	img.crossOrigin = 'anonymous';
	img.onload = () => {
		textDiv.innerHTML = '';
		img.style.cssText = 'width:100%;height:auto;display:block;';
		textDiv.appendChild(img);
		if (label) label.textContent = `Page ${pageNumber} / 1697`;
	};
	img.onerror = async (e) => {
		console.error('pdf-image failed to load:', imgUrl, e);
		try {
			const res = await fetch('/api/pdf-page', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ page: pageNumber })
			});
			const data = await res.json();
			_pdfTotalPages = data.total;
			if (label) label.textContent = `Page ${pageNumber} / ${_pdfTotalPages}`;
			textDiv.innerHTML = `<p style="padding:20px">${data.text.replace(/\n/g, '<br>')}</p>`;
		} catch(e) {
			textDiv.innerHTML = `<p style="color:#c00;padding:20px">Page image not available yet.</p>`;
		}
	};
	img.src = imgUrl;
}

function getOrCreateTextDiv() {
	let textDiv = document.getElementById('bookRefTextDiv');
	if (!textDiv) {
		textDiv = document.createElement('div');
		textDiv.id = 'bookRefTextDiv';
		textDiv.style.cssText = 'flex:1;overflow-y:auto;background:#fff;text-align:center;';
		document.getElementById('bookRefPanel').appendChild(textDiv);
	}
	textDiv.style.display = 'block';
	return textDiv;
}

function showDriveRef(driveUrl, name, page) {
	const overlay = document.getElementById('bookRefOverlay');
	const iframe = document.getElementById('bookRefIframe');
	const title = document.getElementById('bookRefTitle');
	const nav = document.getElementById('bookRefNav');
	const textDiv = document.getElementById('bookRefTextDiv');
	if (!overlay || !iframe) return;

	if (textDiv) textDiv.style.display = 'none';
	overlay.style.display = 'flex';
	if (nav) nav.style.display = 'none';
	if (title) title.textContent = name || 'Source';
	iframe.style.display = 'block';
	iframe.src = driveUrl;
}

window.showDriveRef = showDriveRef;

window.showTextRef = showTextRef;

function showUrlRef(url, name) {
	// YouTube and external sites can't be iframed — open in new tab
	window.open(url, '_blank', 'noopener,noreferrer');
}

function bookRefChangePage(delta) {
	showBookRef(_pdfCurrentPage + delta);
}

function closeBookRef() {
	const overlay = document.getElementById('bookRefOverlay');
	const iframe = document.getElementById('bookRefIframe');
	if (overlay) overlay.style.display = 'none';
	if (iframe) iframe.src = ''; // stop video/pdf
}

window.closeBookRef = closeBookRef;
window.bookRefChangePage = bookRefChangePage;
window.showBookRef = showBookRef;
window.showUrlRef = showUrlRef;
