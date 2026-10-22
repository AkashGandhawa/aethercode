import React, { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import './ChatInterface.css'

export interface Message {
	role: 'user' | 'assistant'
	content: string
	model?: string
	tokens?: number | null
	isError?: boolean
	retryPrompt?: string
	cached?: boolean
}

interface AgentResponse {
	reply?: string
	error?: string
	model?: string
	tokens?: number | null
	isError?: boolean
}

const MODEL_OPTIONS = [
	{ value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
	{ value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
	{ value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B (Groq)' },
	{ value: 'openai/gpt-oss-20b', label: 'GPT OSS 20B (Groq)' },
	{ value: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Groq)' },
	{ value: 'gpt-4o', label: 'GPT-4o (OpenAI)' },
	{ value: 'gpt-4o-mini', label: 'GPT-4o Mini (OpenAI)' },
	{ value: 'claude-3-5-sonnet-20240620', label: 'Claude 3.5 Sonnet (Anthropic)' },
]

function isGroqModel(model: string) {
	return model.includes('llama') || model.includes('mixtral') || model.includes('gpt-oss') || model.includes('qwen')
}

const MODEL_QUOTAS: Record<string, number> = Object.fromEntries(
	MODEL_OPTIONS.map(({ value }) => [value, isGroqModel(value) ? 14400 : 20]),
)

const CHAT_HISTORY_KEY = 'aether_chat_history'
const GEMINI_MODEL = 'gemini-3.8-flash'
const GROQ_MODEL = 'openai/gpt-oss-120b'
const SELECTED_MODEL_KEY = 'aether_selected_model'

function loadSelectedModel(): string {
	try {
		const storedModel = sessionStorage.getItem(SELECTED_MODEL_KEY)
		if (storedModel && MODEL_OPTIONS.some((model) => model.value === storedModel)) {
			return storedModel
		}
	} catch {
		// Fall back to the default model when session storage is unavailable.
	}
	return GEMINI_MODEL
}

function getQuotaKey(model: string) {
	return `aether_quota_${model}_${new Date().toISOString().slice(0, 10)}`
}

function loadQuota(model: string) {
	const quota = MODEL_QUOTAS[model] ?? MODEL_QUOTAS[GEMINI_MODEL]

	try {
		const storedQuota = localStorage.getItem(getQuotaKey(model))
		if (!storedQuota) {
			localStorage.setItem(getQuotaKey(model), String(quota))
			return quota
		}

		const remainingQuota = Number(storedQuota)
		return Number.isFinite(remainingQuota) ? remainingQuota : quota
	} catch {
		return quota
	}
}

function loadChatHistory(): Message[] {
	try {
		const storedHistory = localStorage.getItem(CHAT_HISTORY_KEY)
		if (!storedHistory) return []

		const history = JSON.parse(storedHistory) as unknown
		return Array.isArray(history) ? (history as Message[]) : []
	} catch {
		return []
	}
}

type MarkdownCodeProps = {
	node?: unknown
	inline?: boolean
	className?: string
	children?: ReactNode
}

interface CodeBlockProps {
	language: string
	children: string
}

function CodeBlock({ language, children }: CodeBlockProps) {
	const [isCopied, setIsCopied] = useState(false)

	const handleCopy = (code: string) => {
		void navigator.clipboard.writeText(code)
		setIsCopied(true)
		setTimeout(() => setIsCopied(false), 2000)
	}

	return (
		<div className="code-block">
			<div className="code-header">
				<span className="code-language">{language}</span>
				<button className="copy-code-btn" type="button" onClick={() => handleCopy(children)}>
					{isCopied ? 'Copied!' : 'Copy Code'}
				</button>
			</div>
			<pre><code>{children}</code></pre>
		</div>
	)
}

function renderMarkdown(content: string): ReactNode {
	const components: Components = {
		code: ({ node, inline, className, children, ...props }: MarkdownCodeProps) => {
			const rawCode = String(children)
			const languageMatch = /language-(\w+)/i.exec(className || '')
			if (inline || !languageMatch || !rawCode.includes('\n')) {
				return <code className="inline-code-snippet" {...props}>{children}</code>
			}

			const language = languageMatch[1]
			const blockCode = rawCode.replace(/\n$/, '')

			return <CodeBlock language={language}>{blockCode}</CodeBlock>
		},
		p: ({ children }) => <p>{children}</p>,
		h1: ({ children }) => <h1>{children}</h1>,
		h2: ({ children }) => <h2>{children}</h2>,
		h3: ({ children }) => <h3>{children}</h3>,
		ul: ({ children }) => <ul>{children}</ul>,
		ol: ({ children }) => <ol>{children}</ol>,
		li: ({ children }) => <li>{children}</li>,
		pre: ({ children }) => <>{children}</>,
	}

	return (
		<div className="message-content">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{content}
			</ReactMarkdown>
		</div>
	)
}

function ChatInterface() {
	const [messages, setMessages] = useState<Message[]>(loadChatHistory)
	const [input, setInput] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [selectedModel, setSelectedModel] = useState(loadSelectedModel)
	const [remainingQuota, setRemainingQuota] = useState(() => loadQuota(GEMINI_MODEL))
	const [geminiKey, setGeminiKey] = useState('')
	const [groqKey, setGroqKey] = useState('')
	const [openAiKey, setOpenAiKey] = useState('')
	const [anthropicKey, setAnthropicKey] = useState('')
	const [showApiKeys, setShowApiKeys] = useState(false)
	const abortControllerRef = useRef<AbortController | null>(null)
	const messagesEndRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		try {
			setGeminiKey(localStorage.getItem('aether_gemini_key') || '')
			setGroqKey(localStorage.getItem('aether_groq_key') || '')
			setOpenAiKey(localStorage.getItem('aether_openai_key') || '')
			setAnthropicKey(localStorage.getItem('aether_anthropic_key') || '')
		} catch {
			setGeminiKey('')
			setGroqKey('')
			setOpenAiKey('')
			setAnthropicKey('')
		}
	}, [])

	useEffect(() => {
		setRemainingQuota(loadQuota(selectedModel))
	}, [selectedModel])

	useEffect(() => {
		try {
			localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages))
		} catch {
			// Continue normally when browser storage is unavailable.
		}
	}, [messages])

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
	}, [messages, isLoading])

	useEffect(() => {
		try {
			sessionStorage.setItem(SELECTED_MODEL_KEY, selectedModel)
		} catch {
			// Continue normally when session storage is unavailable.
		}
	}, [selectedModel])

	const clearHistory = () => {
		if (messages.length === 0) return

		const confirmed = window.confirm('Are you sure you want to start a new chat? Your current conversation history will be cleared.')
		if (!confirmed) return

		setMessages([])
		try {
			localStorage.removeItem('aether_chat_history')
		} catch {
			// Continue normally when browser storage is unavailable.
		}
	}

	const exportChat = () => {
		if (messages.length === 0) return

		const exportedAt = new Date()
		const header = [
			'# AetherCode Session',
			'',
			`- Exported: ${exportedAt.toLocaleString()}`,
			`- Model: ${selectedModel}`,
			'',
			'---',
			'',
		].join('\n')
		const turns = messages
			.map((message) => {
				const heading = message.role === 'user' ? '### User' : '### Assistant'
				return `${heading}\n\n${message.content}\n`
			})
			.join('\n')
		const markdown = `${header}${turns}`

		const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
		const url = URL.createObjectURL(blob)
		const downloadLink = document.createElement('a')
		downloadLink.href = url
		downloadLink.download = `aethercode-session-${Date.now()}.md`
		document.body.appendChild(downloadLink)
		downloadLink.click()
		document.body.removeChild(downloadLink)
		URL.revokeObjectURL(url)
	}

	const adjustQuota = () => {
		const enteredQuota = window.prompt('Enter remaining quota for today:', remainingQuota.toString())
		if (enteredQuota === null || enteredQuota.trim() === '') return

		const quota = Number(enteredQuota)
		if (!Number.isInteger(quota) || quota < 0) return

		setRemainingQuota(quota)
		try {
			localStorage.setItem(getQuotaKey(selectedModel), String(quota))
		} catch {
			// Continue normally when browser storage is unavailable.
		}
	}

	const saveApiKeys = () => {
		try {
			localStorage.setItem('aether_gemini_key', geminiKey.trim())
			localStorage.setItem('aether_groq_key', groqKey.trim())
			localStorage.setItem('aether_openai_key', openAiKey.trim())
			localStorage.setItem('aether_anthropic_key', anthropicKey.trim())
		} catch {
			// Continue with in-memory keys when browser storage is unavailable.
		}
		setShowApiKeys(false)
	}

	const findReusableAnswer = (prompt: string): Message | undefined => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const candidate = messages[i]
			if (candidate.role !== 'user' || candidate.content !== prompt) continue

			const answer = messages[i + 1]
			if (answer && answer.role === 'assistant' && !answer.isError && answer.content && answer.model) {
				return answer
			}
		}
		return undefined
	}

	const cancelRequest = () => {
		const controller = abortControllerRef.current
		if (!controller) return

		controller.abort()
		abortControllerRef.current = null
		setIsLoading(false)
		setMessages((currentMessages) => [
			...currentMessages,
			{ role: 'assistant', content: 'Request cancelled by user.' },
		])
	}

	const sendMessage = async (
		event?: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLTextAreaElement>,
		promptOverride?: string,
		modelOverride?: string,
	) => {
		if (event && event.preventDefault) event.preventDefault()

		const activeModel = modelOverride || selectedModel
		const activeQuota = modelOverride ? loadQuota(activeModel) : remainingQuota
		const userText = (promptOverride || input).trim()
		if (!userText || isLoading) return

		const cachedAnswer = modelOverride ? undefined : findReusableAnswer(userText)
		if (cachedAnswer) {
			setMessages((currentMessages) => [
				...currentMessages,
				{ role: 'user', content: userText },
				{ role: 'assistant', content: cachedAnswer.content, model: cachedAnswer.model, tokens: null, cached: true },
			])
			setInput('')
			return
		}

		if (activeQuota <= 0) {
			window.alert('Daily quota for the selected model has been exhausted. Please switch to another model from the dropdown or wait until midnight reset.')
			return
		}
		const history = messages.map(({ role, content }) => ({ role, content }))

		setMessages((currentMessages) => [
			...currentMessages,
			{ role: 'user', content: userText },
		])
		setInput('')
		setIsLoading(true)

		const controller = new AbortController()
		abortControllerRef.current = controller
		let responseStatus = 0
		try {
			const response = await fetch('/.netlify/functions/agent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: userText,
					history,
					model: activeModel,
					userKeys: {
						gemini: geminiKey,
						groq: groqKey,
						openai: openAiKey,
						anthropic: anthropicKey,
					},
				}),
				signal: controller.signal,
			})
			responseStatus = response.status

			const text = await response.text()
			let data: AgentResponse = {}
			let parsedJson = false
			try {
				data = text ? (JSON.parse(text) as AgentResponse) : {}
				parsedJson = true
			} catch {
				data = {}
			}
			const responseDetails = data.error
				|| (parsedJson ? data.reply : '')
				|| `Network error: ${response.statusText}`
			if (!response.ok || data.isError || !data.reply) {
				throw new Error(responseDetails || 'The agent could not process your request.')
			}

			const nextQuota = Math.max(0, activeQuota - 1)
			setRemainingQuota(nextQuota)
			try {
				localStorage.setItem(getQuotaKey(activeModel), String(nextQuota))
			} catch {
				// Continue normally when browser storage is unavailable.
			}

			setMessages((currentMessages) => [
				...currentMessages,
				{
					role: 'assistant',
					content: data.reply || 'The agent returned an empty response.',
					model: data.model || activeModel,
					tokens: data.tokens,
					isError: data.isError,
				},
			])
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') return

			const errorDetails = error instanceof Error ? error.message : String(error)
			const quotaViolation = responseStatus === 429 || /quota|429|RESOURCE_EXHAUSTED|Too Many Requests/i.test(errorDetails)
			let allProvidersRateLimited = activeModel === GROQ_MODEL
			if (quotaViolation) {
				setRemainingQuota(0)
				try {
					localStorage.setItem(getQuotaKey(activeModel), '0')
				} catch {
					// Continue normally when browser storage is unavailable.
				}

				if (activeModel === GEMINI_MODEL) {
					const fallbackQuota = loadQuota(GROQ_MODEL)
					setSelectedModel(GROQ_MODEL)
					setRemainingQuota(fallbackQuota)
					allProvidersRateLimited = fallbackQuota <= 0
				}
			}

			const switchedFromGemini = quotaViolation && activeModel === GEMINI_MODEL && !allProvidersRateLimited
			const errorContent = quotaViolation && allProvidersRateLimited
				? 'All providers are currently rate-limited. Quotas will reset at midnight.'
				: switchedFromGemini
					? 'Upstream quota for Gemini was exhausted outside this session. Automatically switched active model to GPT OSS 120B via Groq.'
					: quotaViolation
						? 'The selected model quota is exhausted for today. Please try again later.'
						: 'Unable to generate code at the moment. Please try again.'
			setMessages((currentMessages) => [
				...currentMessages,
				{
					role: 'assistant',
					content: errorContent,
					isError: true,
					retryPrompt: switchedFromGemini ? userText : undefined,
				},
			])
		} finally {
			if (abortControllerRef.current === controller) {
				abortControllerRef.current = null
				setIsLoading(false)
			}
		}
	}

	return (
		<main className="chat-interface">
			<header className="chat-header">
				<div className="chat-header-inner">
					<div className="chat-heading">
						<h1>AetherCode</h1>
						<p className="chat-kicker">Serverless Code Synthesizer</p>
					</div>
					<div className="header-controls">
						<select
							className="model-select"
							value={selectedModel}
							onChange={(event) => setSelectedModel(event.target.value)}
							aria-label="Select AI model"
						>
							{MODEL_OPTIONS.map((model) => (
								<option value={model.value} key={model.value}>{model.label}</option>
							))}
						</select>
						<button className="clear-btn" type="button" onClick={clearHistory} disabled={isLoading}>
							New Chat
						</button>
						<button className="export-btn" type="button" onClick={exportChat} disabled={messages.length === 0}>
							Export Chat
						</button>
						<button className={`quota-badge${remainingQuota === 0 ? ' quota-empty' : ''}`} type="button" onClick={adjustQuota} title="Click to adjust remaining quota">
							Quota: {remainingQuota}/{MODEL_QUOTAS[selectedModel]} calls left today
						</button>
						<button className="settings-btn" type="button" onClick={() => setShowApiKeys((visible) => !visible)}>
							API Keys
						</button>
						{showApiKeys && (
							<div className="api-keys-panel">
								<label>
									Gemini key
									<input type="password" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} autoComplete="off" />
								</label>
								<label>
									Groq key
									<input type="password" value={groqKey} onChange={(event) => setGroqKey(event.target.value)} autoComplete="off" />
								</label>
									<label>
										OpenAI key
										<input type="password" value={openAiKey} onChange={(event) => setOpenAiKey(event.target.value)} autoComplete="off" />
									</label>
									<label>
										Anthropic key
										<input type="password" value={anthropicKey} onChange={(event) => setAnthropicKey(event.target.value)} autoComplete="off" />
									</label>
									<p className="api-key-disclaimer">Keys are stored locally in your browser and are never saved to our servers. We recommend using keys with strict billing limits.</p>
								<button className="save-keys-btn" type="button" onClick={saveApiKeys}>Save</button>
							</div>
						)}
					</div>
				</div>
			</header>

			<section className="message-list" aria-live="polite" aria-label="Chat messages">
				{messages.length === 0 && (
					<p className="empty-state">Ask the agent to design, explain, or generate code.</p>
				)}
				{messages.map((message, index) => (
					<article className={`message-row ${message.role}`} key={`${message.role}-${index}`}>
						<div className={`message-bubble${message.isError ? ' error-bubble' : ''}`}>
							{message.isError && <span className="error-icon" aria-hidden="true">⚠️</span>}
							{renderMarkdown(message.content)}
							{message.role === 'assistant' && !message.isError && (
								<div className="model-tag">
									{message.cached && <span className="cached-tag">♻️ Already answered — reused, no tokens used</span>}
									<span>⚡ Model: {message.model || GEMINI_MODEL}</span>
									{message.tokens !== null && message.tokens !== undefined && <span>{message.tokens} tokens</span>}
								</div>
							)}
							{message.retryPrompt && (
								<button
									className="fallback-retry-btn"
									type="button"
									disabled={isLoading}
									onClick={() => void sendMessage(undefined, message.retryPrompt, GROQ_MODEL)}
								>
									Resend with GPT OSS 120B
								</button>
							)}
						</div>
					</article>
				))}
				{isLoading && (
					<div className="message-row assistant" role="status">
						<div className="message-bubble loading-bubble">
							<span className="loading-indicator" aria-label="Agent is thinking">
								<i />
								<i />
								<i />
							</span>
						</div>
					</div>
				)}
				<div ref={messagesEndRef} />
			</section>

			<form className="chat-form chat-input-form" onSubmit={sendMessage}>
				<div className="chat-input-inner">
					<textarea
						rows={1}
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && !event.shiftKey) {
								event.preventDefault()
								if (event.currentTarget.value.trim() && !isLoading) void sendMessage(event)
							}
						}}
						placeholder="Describe what you want to build... (Shift+Enter for new line)"
						aria-label="Message"
						disabled={isLoading}
					/>
					{isLoading ? (
						<button className="cancel-btn" type="button" onClick={cancelRequest}>
							Cancel
						</button>
					) : (
						<button type="submit" disabled={!input.trim()}>
							Send
						</button>
					)}
				</div>
				<p className="ai-disclosure">
					AetherCode can make mistakes. Verify critical code and architecture before deployment.
				</p>
			</form>
		</main>
	)
}

export default ChatInterface
