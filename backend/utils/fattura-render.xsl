<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" 
                xmlns:a="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"
                version="1.0">
  <xsl:output method="html" indent="yes" />

  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Fattura <xsl:value-of select="a:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/Numero"/></title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 24px; background: #f5f5f5; }
          #page { background: #fff; padding: 32px; border-radius: 12px; max-width: 1024px; margin: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
          h1, h2, h3 { margin: 0 0 8px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { padding: 8px 10px; border-bottom: 1px solid #ededed; text-align: left; }
          th { background: #f0f4fa; font-weight: 600; }
          .section { margin-top: 32px; }
        </style>
      </head>
      <body>
        <div id="page">
          <div>
            <h1>Fattura elettronica</h1>
            <h3>ID: <xsl:value-of select="a:FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione/IdTrasmittente/IdCodice"/> - <xsl:value-of select="a:FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione/ProgressivoInvio"/></h3>
          </div>

          <xsl:apply-templates select="a:FatturaElettronica"/>
        </div>
      </body>
    </html>
  </xsl:template>

  <xsl:template match="a:FatturaElettronica">
    <div class="section">
      <h2>Dati header</h2>
      <p>
        <strong>Data documento:</strong>
        <xsl:value-of select="a:FatturaElettronicaHeader/DatiGenerali/DatiGeneraliDocumento/Data"/>
        &nbsp;&nbsp;
        <strong>Tipo:</strong>
        <xsl:value-of select="a:FatturaElettronicaHeader/DatiGenerali/DatiGeneraliDocumento/TipoDocumento"/>
        &nbsp;&nbsp;
        <strong>Numero:</strong>
        <xsl:value-of select="a:FatturaElettronicaHeader/DatiGenerali/DatiGeneraliDocumento/Numero"/>
      </p>
      <h3>Cedente/prestatore</h3>
      <ul>
        <li><strong>Denominazione:</strong> <xsl:value-of select="a:FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/Anagrafica/Denominazione"/></li>
        <li><strong>Partita IVA:</strong> <xsl:value-of select="a:FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/IdFiscaleIVA/IdCodice"/></li>
        <li><strong>Codice fiscale:</strong> <xsl:value-of select="a:FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/CodiceFiscale"/></li>
      </ul>
      <h3>Cessionario / committente</h3>
      <ul>
        <li><strong>Denominazione:</strong> <xsl:value-of select="a:FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/Anagrafica/Denominazione"/></li>
        <li><strong>Partita IVA:</strong> <xsl:value-of select="a:FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/IdFiscaleIVA/IdCodice"/></li>
        <li><strong>Codice fiscale:</strong> <xsl:value-of select="a:FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/CodiceFiscale"/></li>
      </ul>
    </div>

    <div class="section">
      <h2>Riepilogo</h2>
      <table>
        <tr>
          <th>Aliquota/Natura</th>
          <th>Imponibile</th>
          <th>Imposta</th>
        </tr>
        <xsl:for-each select="a:FatturaElettronicaBody/DatiBeniServizi/DatiRiepilogo">
          <tr>
            <td>
              <xsl:value-of select="concat(@AliquotaIVA, ' %')"/>
              <xsl:if test="@Natura!=''"> - <xsl:value-of select="@Natura"/></xsl:if>
            </td>
            <td>€ <xsl:value-of select="format-number(@ImponibileImporto, '#,##0.00')"/></td>
            <td>€ <xsl:value-of select="format-number(@Imposta, '#,##0.00')"/></td>
          </tr>
        </xsl:for-each>
      </table>
    </div>

    <div class="section">
      <h2>Dettaglio linee</h2>
      <table>
        <tr>
          <th>Descrizione</th>
          <th>Quantità</th>
          <th>Prezzo</th>
          <th>Totale</th>
        </tr>
        <xsl:for-each select="a:FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee">
          <tr>
            <td><xsl:value-of select="concat(Descrizione, ' / ', CodiceArticolo/CodiceValore)"/></td>
            <td><xsl:value-of select="Quantita"/></td>
            <td>€ <xsl:value-of select="format-number(PrezzoUnitario, '#,##0.00')"/></td>
            <td>€ <xsl:value-of select="format-number(PrezzoTotale, '#,##0.00')"/></td>
          </tr>
        </xsl:for-each>
      </table>
    </div>
  </xsl:template>
</xsl:stylesheet>
