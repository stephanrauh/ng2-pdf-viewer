import { Injectable } from '@angular/core';
import { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFPageView } from './pdf_page_view';

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

  public getCurrentViewer: () => any;

  constructor() {}

  public async print(printResolution = 300, autoRotate = true): Promise<void> {
    const currentViewer = this.getCurrentViewer();
    const pages = currentViewer._pages;
    const pdfDocument = currentViewer.pdfDocument;
    const scratchCanvas = document.createElement('canvas');
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const pagesOverview = this.getPagesOverview(pages, autoRotate);
    const firstPageSize = pagesOverview[0];
    const hasEqualPageSizes = pagesOverview.every(
      (size) =>
        size.width === firstPageSize.width &&
        size.height === firstPageSize.height
    );
    if (!hasEqualPageSizes) {
      console.warn(
        'Not all pages have the same size. The printed result may be incorrect!'
      );
    }

    // Insert a @page + size rule to make sure that the page size is correctly
    // set. Note that we assume that all pages have the same size, because
    // variable-size pages are not supported yet (e.g. in Chrome & Firefox).

    const pageStyleSheet = document.createElement('style');
    const pageSize = firstPageSize;
    pageStyleSheet.textContent =
      // "size:<width> <height>" is what we need. But also add "A4" because
      // Firefox incorrectly reports support for the other value.
      `@supports ((size:A4) and (size:1pt 1pt)) {
        @page { size: ${pageSize.width}px ${pageSize.height}px; }
       }
       #printContainer {
        height: 100%;
      }
      /* wrapper around (scaled) print canvas elements */
      #printContainer, #printContainer * {
        margin: 0;
        border: 0;
        padding: 0;
      }
      #printContainer > div {
        position: relative;
        top: 0;
        left: 0;
        width: 1px;
        height: 1px;
        overflow: visible;
        page-break-after: always;
        page-break-inside: avoid;
      }
      #printContainer canvas,
      #printContainer img {
        direction: ltr;
        display: block;
      }
       `;
    iframe.id = 'printContainer';
    iframe.appendChild(pageStyleSheet);

    const iFrameBody = iframe.contentDocument.documentElement.querySelector('body');
    iFrameBody.style.margin="0";

    await this.renderPages(
      printResolution,
      pagesOverview,
      pdfDocument,
      iFrameBody,
      scratchCanvas
    );

    iframe.contentWindow.print();
    document.body.removeChild(iframe);
  }

  private async renderPages(
    printResolution: number,
    pagesOverview: Array<PageOverview>,
    pdfDocument: PDFDocumentProxy,
    iFrameBody: HTMLBodyElement,
    scratchCanvas: HTMLCanvasElement
  ): Promise<void> {
    const pageCount = pagesOverview.length;
    let currentPage = -1;
    while (++currentPage < pageCount) {
      // renderProgress(index, window.filteredPageCount | pageCount, this.l10n, this.eventBus); // #243 and #588 modified by ngx-extended-pdf-viewer
      const printItem = await this.renderPage(
        /* pageNumber = */ currentPage + 1,
        pagesOverview[currentPage],
        printResolution,
        pdfDocument,
        scratchCanvas
      );

      await this.useRenderedPage(printItem, iFrameBody, scratchCanvas);
    }
  }

  private async useRenderedPage(
    printItem: PrintItem,
    iFrameBody: HTMLBodyElement,
    scratchCanvas: HTMLCanvasElement
  ): Promise<void> {
    // Checks if possible to use URL.createObjectURL()
    const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isIE = /Trident/.test(userAgent);
    const isIOSChrome = /CriOS/.test(userAgent);
    const disableCreateObjectURL = isIE || isIOSChrome;

    const img = document.createElement('img');
    img.style.width = printItem.width;
    img.style.height = printItem.height;

    if ('toBlob' in scratchCanvas && !disableCreateObjectURL) {
      scratchCanvas.toBlob((blob) => (img.src = URL.createObjectURL(blob)));
    } else {
      img.src = scratchCanvas.toDataURL();
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(img);
    iFrameBody.appendChild(wrapper);

    return new Promise(function (resolve, reject) {
      img.onload = () => resolve();
      img.onerror = reject;
    });
  }

  /*
   * Returns sizes of the pages.
   * @returns {Array} Array of objects with width/height/rotation fields.
   */
  private getPagesOverview(
    pages: Array<PDFPageView>,
    autoRotate: boolean
  ): Array<PageOverview> {
    const pagesOverview = pages.map((pageView) => {
      const viewport = pageView.pdfPage.getViewport({ scale: 1 });
      return {
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
      };
    });
    if (!autoRotate) {
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
    pageNumber: number,
    size: PageOverview,
    printResolution: number,
    pdfDocument: PDFDocumentProxy,
    scratchCanvas: HTMLCanvasElement
  ): Promise<PrintItem> {
    // The size of the canvas in pixels for printing.
    let PRINT_UNITS = printResolution / 72.0;
    const CSS_UNITS = 96.0 / 72.0;

    let scale = 1;

    PRINT_UNITS *= scale;

    scratchCanvas.width = Math.floor(size.width * PRINT_UNITS);
    scratchCanvas.height = Math.floor(size.height * PRINT_UNITS);

    // The physical size of the img as specified by the PDF document.
    const width = Math.floor(size.width * CSS_UNITS) + 'px';
    const height = Math.floor(size.height * CSS_UNITS) + 'px';

    const ctx = scratchCanvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = 'rgb(255, 255, 255)';
    ctx.fillRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    ctx.restore();

    const pdfPage = await pdfDocument.getPage(pageNumber);
    const renderContext = {
      canvasContext: ctx,
      transform: [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0],
      viewport: pdfPage.getViewport({ scale: 1, rotation: size.rotation }),
      intent: 'print',
      annotationStorage: (pdfDocument as any).annotationStorage,
    };

    await pdfPage.render(renderContext).promise;
    return {
      width,
      height,
    };
  }
}
