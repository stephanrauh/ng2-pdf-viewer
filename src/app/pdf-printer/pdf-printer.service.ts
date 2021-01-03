import { Injectable } from '@angular/core';
import { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFPageView } from './pdf_page_view';

const userAgent =
  (typeof navigator !== 'undefined' && navigator.userAgent) || '';

const isIE = /Trident/.test(userAgent);

const isIOSChrome = /CriOS/.test(userAgent);

interface PrintItem {
  width: string;
  height: string;
}

interface PageOverview {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

@Injectable({
  providedIn: 'root',
})
export class PdfPrinterService {
  // Checks if possible to use URL.createObjectURL()
  private readonly disableCreateObjectURL = isIE || isIOSChrome;

  private currentPage: number = -1;
  private scratchCanvas: HTMLCanvasElement;

  private printContainer: HTMLIFrameElement;

  public getCurrentViewer: () => any;

  private pagesOverview: Array<PageOverview>;

  private enablePrintAutoRotate = true;

  private _printResolution = 300;

  private pages: Array<PDFPageView>;

  private pdfDocument: PDFDocumentProxy;

  constructor() {}

  public async print(): Promise<void> {
    const currentViewer = this.getCurrentViewer();
    this.pages = currentViewer._pages;
    this.pdfDocument = currentViewer.pdfDocument;
    this.scratchCanvas = document.createElement('canvas');
    this.currentPage = -1;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    this.pagesOverview = this.getPagesOverview();
    const hasEqualPageSizes = this.pagesOverview.every(function (size) {
      return (
        size.width === this.pagesOverview[0].width &&
        size.height === this.pagesOverview[0].height
      );
    }, this);
    if (!hasEqualPageSizes) {
      console.warn(
        'Not all pages have the same size. The printed ' +
          'result may be incorrect!'
      );
    }

    // Insert a @page + size rule to make sure that the page size is correctly
    // set. Note that we assume that all pages have the same size, because
    // variable-size pages are not supported yet (e.g. in Chrome & Firefox).
    // TODO(robwu): Use named pages when size calculation bugs get resolved
    // (e.g. https://crbug.com/355116) AND when support for named pages is
    // added (http://www.w3.org/TR/css3-page/#using-named-pages).
    // In browsers where @page + size is not supported (such as Firefox,
    // https://bugzil.la/851441), the next stylesheet will be ignored and the
    // user has to select the correct paper size in the UI if wanted.
    const pageStyleSheet = document.createElement('style');
    const pageSize = this.pagesOverview[0];
    pageStyleSheet.textContent =
      // "size:<width> <height>" is what we need. But also add "A4" because
      // Firefox incorrectly reports support for the other value.
      '@supports ((size:A4) and (size:1pt 1pt)) {' +
      '@page { size: ' +
      pageSize.width +
      'pt ' +
      pageSize.height +
      'pt;}' +
      '}';
    iframe.appendChild(pageStyleSheet);
    this.printContainer = iframe;

    await this.renderPages();

    iframe.contentWindow.print();
    console.log("After print");
    document.body.removeChild(iframe);
  }

  private async renderPages(): Promise<void> {
    const pageCount = this.pagesOverview.length;
    while (++this.currentPage < pageCount) {

      const index = this.currentPage;
      // renderProgress(index, window.filteredPageCount | pageCount, this.l10n, this.eventBus); // #243 and #588 modified by ngx-extended-pdf-viewer
      const printItem = await this.renderPage(
        /* pageNumber = */ index + 1,
        this.pagesOverview[index],
        this._printResolution
      );

      await this.useRenderedPage(printItem);
    }
  }

  private async useRenderedPage(printItem: PrintItem): Promise<void> {
    const img = document.createElement('img');
    img.style.width = printItem.width;
    img.style.height = printItem.height;

    const scratchCanvas = this.scratchCanvas;
    if ('toBlob' in scratchCanvas && !this.disableCreateObjectURL) {
      scratchCanvas.toBlob((blob) => (img.src = URL.createObjectURL(blob)));
    } else {
      img.src = scratchCanvas.toDataURL();
    }

    const iframeBody = this.printContainer.contentDocument.documentElement.querySelector('body');

    const wrapper = document.createElement('div');
    wrapper.appendChild(img);
    iframeBody.appendChild(wrapper);

    return new Promise(function (resolve, reject) {
      img.onload = () => resolve();
      img.onerror = reject;
    });
  }

  /*
   * Returns sizes of the pages.
   * @returns {Array} Array of objects with width/height/rotation fields.
   */
  private getPagesOverview(): Array<PageOverview> {
    const pagesOverview = this.pages.map(pageView => {
      const viewport = pageView.pdfPage.getViewport({ scale: 1 });
      return {
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
      };
    });
    if (!this.enablePrintAutoRotate) {
      return pagesOverview;
    }
    return pagesOverview.map(function (size) {
      if (size.width <= size.height) {
        return size;
      }
      return {
        width: size.height,
        height: size.width,
        rotation: (size.rotation + 90) % 360,
      };
    });
  }

  private async renderPage(
    pageNumber,
    size,
    printResolution
  ): Promise<PrintItem> {
    const scratchCanvas = this.scratchCanvas;

    // The size of the canvas in pixels for printing.
    let PRINT_UNITS = printResolution / 72.0;
    const CSS_UNITS = 96.0 / 72.0;

    // modified by ngx-extended-pdf-viewer #387
    let scale = 1;

    PRINT_UNITS *= scale;

    scratchCanvas.width = Math.floor(size.width * PRINT_UNITS);
    scratchCanvas.height = Math.floor(size.height * PRINT_UNITS);

    // The physical size of the img as specified by the PDF document.
    const width = Math.floor(size.width * CSS_UNITS) + 'px';
    const height = Math.floor(size.height * CSS_UNITS) + 'px';
    // end of modification

    const ctx = scratchCanvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = 'rgb(255, 255, 255)';
    ctx.fillRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    ctx.restore();

    const pdfPage = await this.pdfDocument.getPage(pageNumber);
    const renderContext = {
      canvasContext: ctx,
      transform: [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0],
      viewport: pdfPage.getViewport({ scale: 1, rotation: size.rotation }),
      intent: 'print',
      annotationStorage: (this.pdfDocument as any).annotationStorage,
    };

    await pdfPage.render(renderContext).promise;
    return {
      width,
      height,
    };
  }
}
