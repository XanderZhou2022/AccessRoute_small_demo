import AppKit
import Foundation
import PDFKit
import WebKit

@MainActor
final class ManualExporter: NSObject, WKNavigationDelegate {
  private let webView: WKWebView
  private var navigationContinuation: CheckedContinuation<Void, Error>?

  override init() {
    let configuration = WKWebViewConfiguration()
    webView = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 794, height: 1123),
      configuration: configuration
    )
    super.init()
    webView.navigationDelegate = self
  }

  func export(htmlURL: URL, pdfURL: URL) async throws {
    try await withCheckedThrowingContinuation { continuation in
      navigationContinuation = continuation
      webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
    }

    try await Task.sleep(for: .seconds(1))
    let pdfData = try await withCheckedThrowingContinuation { continuation in
      webView.createPDF(configuration: WKPDFConfiguration()) { result in
        continuation.resume(with: result)
      }
    }
    let breakpoints = try await pageBreakpoints()
    try paginate(pdfData: pdfData, breakpoints: breakpoints, outputURL: pdfURL)
    print("Created \(pdfURL.path)")
  }

  private func pageBreakpoints() async throws -> [[CGFloat]] {
    let script = """
      JSON.stringify(
        [...document.querySelectorAll('body > section')].map(section => [
          section.getBoundingClientRect().top + window.scrollY,
          ...[...section.children]
            .filter(element => !/^H[1-6]$/.test(element.tagName))
            .map(element => element.getBoundingClientRect().bottom + window.scrollY),
          section.getBoundingClientRect().bottom + window.scrollY
        ])
      )
      """
    return try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<[[CGFloat]], Error>) in
      webView.evaluateJavaScript(script) { result, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let json = result as? String, let data = json.data(using: .utf8) else {
          continuation.resume(
            throwing: NSError(
              domain: "ProductManualExport",
              code: 2,
              userInfo: [NSLocalizedDescriptionKey: "Could not read manual page breakpoints"]
            )
          )
          return
        }
        do {
          guard let values = try JSONSerialization.jsonObject(with: data) as? [[Double]] else {
            throw NSError(
              domain: "ProductManualExport",
              code: 6,
              userInfo: [NSLocalizedDescriptionKey: "Page breakpoints were not a section array"]
            )
          }
          continuation.resume(returning: values.map { section in
            section.map { CGFloat($0) }
          })
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func paginate(pdfData: Data, breakpoints: [[CGFloat]], outputURL: URL) throws {
    guard
      let sourceDocument = PDFDocument(data: pdfData),
      let sourcePage = sourceDocument.page(at: 0),
      let provider = CGDataProvider(data: pdfData as CFData),
      let sourcePDF = CGPDFDocument(provider),
      let sourceCGPage = sourcePDF.page(at: 1)
    else {
      throw NSError(
        domain: "ProductManualExport",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "WebKit did not return a readable PDF page"]
      )
    }

    let sourceBounds = sourcePage.bounds(for: .mediaBox)
    let pageSize = CGSize(width: 595.28, height: 841.89)
    let scale = pageSize.width / sourceBounds.width
    let topMargin: CGFloat = 24
    let bottomMargin: CGFloat = 24
    let maximumSliceHeight = (pageSize.height - topMargin - bottomMargin) / scale
    guard let consumer = CGDataConsumer(url: outputURL as CFURL) else {
      throw NSError(
        domain: "ProductManualExport",
        code: 4,
        userInfo: [NSLocalizedDescriptionKey: "Could not create \(outputURL.path)"]
      )
    }
    var mediaBox = CGRect(origin: .zero, size: pageSize)
    guard let context = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else {
      throw NSError(
        domain: "ProductManualExport",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Could not initialize PDF output"]
      )
    }

    func drawPage(from start: CGFloat, to end: CGFloat) {
      let yOffset = pageSize.height - topMargin - scale * (sourceBounds.height - start)
      let sliceHeight = scale * (end - start)
      let cropBounds = CGRect(
        x: 0,
        y: pageSize.height - topMargin - sliceHeight,
        width: pageSize.width,
        height: sliceHeight
      )
      context.beginPage(mediaBox: &mediaBox)
      context.setFillColor(NSColor.white.cgColor)
      context.fill(mediaBox)
      context.clip(to: cropBounds)
      context.saveGState()
      context.translateBy(x: 0, y: yOffset)
      context.scaleBy(x: scale, y: scale)
      context.drawPDFPage(sourceCGPage)
      context.restoreGState()
      context.endPage()
    }

    for (index, section) in breakpoints.enumerated() {
      guard let sectionStart = section.first, let sectionEnd = section.last else {
        continue
      }
      var start = index == 0 ? 0 : sectionStart
      while start < sectionEnd {
        let maximumEnd = min(start + maximumSliceHeight, sectionEnd)
        let candidates = section.filter { $0 > start + 240 && $0 <= maximumEnd }
        let end = candidates.last ?? maximumEnd
        drawPage(from: start, to: end)
        start = end
      }
    }
    context.closePDF()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    navigationContinuation?.resume()
    navigationContinuation = nil
  }

  func webView(
    _ webView: WKWebView,
    didFail navigation: WKNavigation!,
    withError error: Error
  ) {
    navigationContinuation?.resume(throwing: error)
    navigationContinuation = nil
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    navigationContinuation?.resume(throwing: error)
    navigationContinuation = nil
  }
}

@main
struct ExportProductManuals {
  @MainActor
  static func main() async throws {
    guard CommandLine.arguments.count == 2 else {
      fputs("Usage: swift scripts/export-product-manuals.swift <docs-directory>\n", stderr)
      exit(EXIT_FAILURE)
    }

    let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let exporter = ManualExporter()

    for language in ["en", "zh-Hant"] {
      let htmlURL = directory.appendingPathComponent("product-manual-v2.\(language).html")
      let pdfURL = directory.appendingPathComponent("product-manual-v2.\(language).pdf")
      try await exporter.export(htmlURL: htmlURL, pdfURL: pdfURL)
    }
  }
}
