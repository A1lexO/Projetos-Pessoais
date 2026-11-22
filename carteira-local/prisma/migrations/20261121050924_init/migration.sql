-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticker" TEXT NOT NULL,
    "name" TEXT,
    "assetClass" TEXT NOT NULL,
    "sector" TEXT,
    "cnpj" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FixedIncomeTerms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "indexer" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "issueDate" DATETIME,
    "maturityDate" DATETIME NOT NULL,
    "issuer" TEXT,
    "isTaxExempt" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    CONSTRAINT "FixedIncomeTerms_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tradeDate" DATETIME NOT NULL,
    "quantity" REAL NOT NULL,
    "unitPrice" REAL NOT NULL,
    "fees" REAL NOT NULL DEFAULT 0,
    "taxes" REAL NOT NULL DEFAULT 0,
    "factor" REAL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "importBatchId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Provento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "comDate" DATETIME,
    "paymentDate" DATETIME NOT NULL,
    "quantity" REAL,
    "grossAmount" REAL NOT NULL,
    "taxWithheld" REAL NOT NULL DEFAULT 0,
    "netAmount" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "importBatchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Provento_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Provento_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileKind" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorLog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PriceQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "close" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceQuote_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Benchmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sgsCode" INTEGER,
    "valueKind" TEXT NOT NULL,
    "lastSyncAt" DATETIME
);

-- CreateTable
CREATE TABLE "BenchmarkValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "benchmarkId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    CONSTRAINT "BenchmarkValue_benchmarkId_fkey" FOREIGN KEY ("benchmarkId") REFERENCES "Benchmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "marketValue" REAL NOT NULL,
    "provCash" REAL NOT NULL DEFAULT 0,
    "totalValue" REAL NOT NULL,
    "netFlow" REAL NOT NULL DEFAULT 0,
    "investedCost" REAL NOT NULL,
    "dailyReturn" REAL NOT NULL DEFAULT 0,
    "quota" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "quantity" REAL NOT NULL,
    "averagePrice" REAL NOT NULL,
    "price" REAL NOT NULL,
    "marketValue" REAL NOT NULL,
    CONSTRAINT "PositionSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_ticker_key" ON "Asset"("ticker");

-- CreateIndex
CREATE INDEX "Asset_assetClass_idx" ON "Asset"("assetClass");

-- CreateIndex
CREATE UNIQUE INDEX "FixedIncomeTerms_assetId_key" ON "FixedIncomeTerms"("assetId");

-- CreateIndex
CREATE INDEX "Transaction_assetId_tradeDate_idx" ON "Transaction"("assetId", "tradeDate");

-- CreateIndex
CREATE INDEX "Transaction_tradeDate_idx" ON "Transaction"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_source_externalId_key" ON "Transaction"("source", "externalId");

-- CreateIndex
CREATE INDEX "Provento_assetId_paymentDate_idx" ON "Provento"("assetId", "paymentDate");

-- CreateIndex
CREATE INDEX "Provento_paymentDate_idx" ON "Provento"("paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "Provento_source_externalId_key" ON "Provento"("source", "externalId");

-- CreateIndex
CREATE INDEX "PriceQuote_date_idx" ON "PriceQuote"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PriceQuote_assetId_date_key" ON "PriceQuote"("assetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Benchmark_code_key" ON "Benchmark"("code");

-- CreateIndex
CREATE INDEX "BenchmarkValue_date_idx" ON "BenchmarkValue"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkValue_benchmarkId_date_key" ON "BenchmarkValue"("benchmarkId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSnapshot_date_key" ON "PortfolioSnapshot"("date");

-- CreateIndex
CREATE INDEX "PositionSnapshot_date_idx" ON "PositionSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PositionSnapshot_assetId_date_key" ON "PositionSnapshot"("assetId", "date");
