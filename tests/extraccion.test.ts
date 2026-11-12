import { describe, expect, test } from "bun:test";
import type { Contrato } from "../src/dominio/contrato.ts";
import { finDePlazo } from "../src/dominio/fechas.ts";
import { similitud, slugCliente } from "../src/dominio/texto.ts";
import { extraerContrato } from "../src/extraccion/extractor.ts";
import { parsearMonto } from "../src/extraccion/valor.ts";
import { contratoModificado, leerFixture } from "./apoyo.ts";

async function extraerFixture(mensaje: string, adjunto = "contrato.txt"): Promise<Contrato> {
  const resultado = extraerContrato(await leerFixture("buzon", mensaje, adjunto));
  if (!resultado.ok) throw new Error(resultado.error);
  return resultado.data;
}

const valores = (contrato: Contrato) => ({
  id_contrato: contrato.id_contrato.valor,
  cliente: contrato.cliente.valor,
  nit_cliente: contrato.nit_cliente.valor,
  pais: contrato.pais.valor,
  valor: contrato.valor.valor,
  moneda: contrato.moneda.valor,
  fecha_inicio: contrato.fecha_inicio.valor,
  fecha_fin: contrato.fecha_fin.valor,
  requiere_poliza: contrato.requiere_poliza.valor,
  tipo_poliza: contrato.tipo_poliza.valor,
});

describe("extracción determinista de prosa legal", () => {
  test("msg-001: contrato con póliza de cumplimiento y fechas escritas", async () => {
    const contrato = await extraerFixture("msg-001");
    expect(valores(contrato)).toEqual({
      id_contrato: "CT-2026-015",
      cliente: "Industrias Delta S.A.S.",
      nit_cliente: "890900111",
      pais: "CO",
      valor: 265000000,
      moneda: "COP",
      fecha_inicio: "2026-08-01",
      fecha_fin: "2027-07-31",
      requiere_poliza: true,
      tipo_poliza: "cumplimiento",
    });
    expect(contrato.objeto.valor).toContain("plataforma CRM");
  });

  test("msg-002: RUC de Ecuador, USD con coma de miles y sin cláusula de garantías", async () => {
    expect(valores(await extraerFixture("msg-002"))).toMatchObject({
      nit_cliente: "1790012345001",
      pais: "EC",
      valor: 120000,
      moneda: "USD",
      fecha_fin: "2027-08-14",
      requiere_poliza: false,
      tipo_poliza: "",
    });
  });

  test("msg-003: otrosí que referencia el contrato original y solo trae los campos modificados", async () => {
    const otrosi = await extraerFixture("msg-003", "otrosi.txt");
    expect(otrosi.tipo_documento).toBe("otrosi");
    expect(otrosi.numero_otrosi).toBe(1);
    expect(otrosi.campos_modificados).toEqual(["fecha_fin", "valor", "moneda"]);
    expect(valores(otrosi)).toMatchObject({ id_contrato: "CT-2026-011", nit_cliente: "20512345678", pais: "PE", valor: 520000, moneda: "PEN", fecha_fin: "2027-11-01" });
    expect(otrosi.fecha_inicio).toEqual({ valor: null, confianza: 0 });
    expect(otrosi.requiere_poliza).toEqual({ valor: null, confianza: 0 });
  });

  test("msg-005: una cotización no es contrato y no se inventan campos", async () => {
    const cotizacion = await extraerFixture("msg-005", "cotizacion.txt");
    expect(cotizacion.tipo_documento).toBe("otro");
    expect(cotizacion.valor).toEqual({ valor: null, confianza: 0 });
  });

  test("msg-006: valor indeterminado y plazo en meses desde una firma sin día quedan con confianza baja", async () => {
    const marco = await extraerFixture("msg-006");
    expect(marco.valor_indeterminado).toBe(true);
    expect(marco.valor).toMatchObject({ valor: 0, confianza: 0.5 });
    expect(marco.fecha_inicio).toMatchObject({ valor: "2026-08-01", confianza: 0.5 });
    expect(marco.fecha_fin).toMatchObject({ valor: "2027-08-31", confianza: 0.5 });
    expect(marco.moneda.valor).toBe("COP");
    expect(marco.requiere_poliza.valor).toBe(false);
    expect(marco.objeto.valor?.length).toBeLessThanOrEqual(200);
  });

  test("nunca toma a Periferia (CONTRATISTA) como cliente", async () => {
    for (const mensaje of ["msg-001", "msg-002", "msg-004", "msg-006"]) {
      expect((await extraerFixture(mensaje)).nit_cliente.valor).not.toBe("900123456");
    }
  });
});

describe("HU-6: errores de datos legibles", () => {
  test("texto vacío", () => {
    expect(extraerContrato("   \n")).toEqual({ ok: false, error: "el texto del contrato está vacío" });
  });

  test("fecha inválida", async () => {
    const resultado = extraerContrato(await contratoModificado({ "treinta y uno (31) de julio de 2027": "treinta y uno (31) de febrero de 2027" }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toContain("fecha inválida");
  });

  test("moneda desconocida", async () => {
    const resultado = extraerContrato(await contratoModificado({ "COP $265.000.000": "EUR 265.000" }));
    expect(resultado).toEqual({ ok: false, error: 'moneda desconocida en el documento: "EUR" (admitidas: COP, USD, PEN, PAB, HNL)' });
  });
});

describe("utilidades", () => {
  test("montos con separadores colombianos y anglosajones", () => {
    expect(parsearMonto("265.000.000")).toBe(265000000);
    expect(parsearMonto("120,000.00")).toBe(120000);
    expect(parsearMonto("1.234,5")).toBe(1234.5);
  });

  test("fin de plazo en meses es inclusivo", () => {
    expect(finDePlazo("2026-08-15", 12)).toBe("2027-08-14");
    expect(finDePlazo("2026-05-15", 6)).toBe("2026-11-14");
  });

  test("slug de cliente compatible con las rutas del maestro", () => {
    expect(slugCliente("Universidad del Valle del Río")).toBe("universidad-del-valle-del-rio");
    expect(slugCliente("Agroexport Sula S. de R.L.")).toBe("agroexport-sula");
    expect(slugCliente("Minera Los Andes S.A.C.")).toBe("minera-los-andes");
  });

  test("similitud de objeto", () => {
    expect(similitud("Mesa de servicio TI", "mesa de servicio ti")).toBe(1);
    expect(similitud("Servicios de arquitectura de nube y migración", "Fábrica de software")).toBeLessThan(0.9);
  });
});
