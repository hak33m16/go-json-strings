/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport,
	CodeActionKind,
	CodeAction
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

const MAX_PROBLEMS = 100
const SOURCE = 'go-json-strings'

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			},
			codeActionProvider: {
				codeActionKinds: [CodeActionKind.QuickFix],
				resolveProvider: false,
				workDoneProgress: false
			}
		}
	};

	return result;
});

connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document !== undefined) {
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: await validateTextDocument(document)
		} satisfies DocumentDiagnosticReport;
	} else {
		// We don't know the document. We can either try to read it from disk
		// or we don't report problems for it.
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: []
		} satisfies DocumentDiagnosticReport;
	}
});

connection.onCodeAction(handler => {
	if (DIAGNOSTIC_CODE_ACTIONS[handler.textDocument.uri] === undefined) {
		return
	}

	for (const item of handler.context.diagnostics) {
		if (item.source === SOURCE && item.data?.id) {
			return [DIAGNOSTIC_CODE_ACTIONS[handler.textDocument.uri][item.data?.id]]
		}
	}
})

interface DocumentMap {
	[key: string]: ActionMap
}

interface ActionMap {
	[key: string]: CodeAction
}

const DIAGNOSTIC_CODE_ACTIONS: DocumentMap = {}

async function validateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {
	DIAGNOSTIC_CODE_ACTIONS[textDocument.uri] = {}

	const text = textDocument.getText();

	const firstLineBreakPos = text.indexOf('\n')
	const lineEnding = text[firstLineBreakPos - 1] === '\r' ? '\r\n' : '\n'

	const pattern = "// @json";
	const multilineCommentDelimiter = '`'
	
	let problems = 0;
	const diagnostics: Diagnostic[] = []
	let currentJSONStringPos = text.indexOf(pattern);
	while (currentJSONStringPos !== -1 && problems < MAX_PROBLEMS) {
		const start = text.indexOf(multilineCommentDelimiter, currentJSONStringPos) + 1
		let cursor = start
		while (text[cursor] != multilineCommentDelimiter) {
			if (text[cursor] === undefined) {
				return diagnostics
			}

			++cursor
		}
		
		const JSONString = text.substring(start, cursor)
		let parsedJSON
		try {
			parsedJSON = JSON.parse(JSONString)

			const expectedJSONFormat = lineEnding + JSON.stringify(parsedJSON, null, '\t').replace(/\n/g, lineEnding) + lineEnding
			if (JSONString != expectedJSONFormat) {
				++problems

				const id = 'format-pos-' + currentJSONStringPos.toString()

				const diagnostic: Diagnostic = {
					severity: DiagnosticSeverity.Warning,
					range: {
						start: textDocument.positionAt(currentJSONStringPos),
						end: textDocument.positionAt(cursor),
					},
					message: `JSON string not formatted as expected`,
					source: SOURCE,
					data: {
						id: id
					}
				}
				diagnostics.push(diagnostic)

				DIAGNOSTIC_CODE_ACTIONS[textDocument.uri][id] = {
					title: 'Format JSON string',
					isPreferred: true,
					kind: CodeActionKind.QuickFix,
					edit: {
						changes: {
							[textDocument.uri]: [
								{
									newText: expectedJSONFormat,
									range: {
										start: textDocument.positionAt(start),
										end: textDocument.positionAt(cursor)
									}
								}
							]
						}
					}
				}
			}
		} catch (e) {
			++problems

			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				range: {
					start: textDocument.positionAt(currentJSONStringPos),
					end: textDocument.positionAt(cursor),
				},
				message: `Failed to parse this string as JSON with error:\n ${e}`,
				source: SOURCE,
			}
			diagnostics.push(diagnostic)
		}

		currentJSONStringPos = text.indexOf(pattern, cursor + 1)
	}

	return diagnostics
}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
