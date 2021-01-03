import { TestBed } from '@angular/core/testing';

import { PdfPrinterService } from './pdf-printer.service';

describe('PdfPrinterService', () => {
  let service: PdfPrinterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfPrinterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
