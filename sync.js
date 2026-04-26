require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Inicialización de Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  const urlApi = 'https://api.finapartner.com/api/inventory?pageSize=500';

  console.log("📡 Conectando con la API de Inventario de Fina...");

  try {
    const response = await fetch(urlApi, {
      headers: {
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json',
        'Origin': 'https://bbtiendadelicores.finapartner.com',
        'Referer': 'https://bbtiendadelicores.finapartner.com/'
      }
    });

    const json = await response.json();

    if (!json.data || !Array.isArray(json.data)) {
      console.log("⚠️ Error: No se recibió la data esperada de la API.");
      return;
    }

    const productosFina = json.data;
    console.log(`📦 Encontrados ${productosFina.length} productos en el sistema original.`);

    // --- PASO 1: Sincronizar Categorías ---
    const categoriasUnicas = new Map();
    productosFina.forEach(p => {
      const nombre = (p.category || 'Sin Categoría').trim();
      const slug = nombre.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!categoriasUnicas.has(slug)) {
        categoriasUnicas.set(slug, nombre);
      }
    });

    const { data: finalCats, error: catError } = await supabase
      .from('categorias')
      .upsert(Array.from(categoriasUnicas).map(([slug, nombre]) => ({ nombre, slug })), { onConflict: 'slug' })
      .select();

    if (catError) throw catError;

    const catMap = {};
    finalCats.forEach(c => {
      catMap[c.nombre.toLowerCase().trim()] = c.id;
    });

    // --- PASO 2: Sincronización con Escudo de Protección ---
    const productosVistos = new Set();
    let procesados = 0;
    let errores = 0;

    console.log(`📤 Iniciando actualización inteligente de ${productosFina.length} productos...`);

    for (const prod of productosFina) {
      const nombreNormalizado = prod.name.trim().toLowerCase();
      
      // Evitar procesar el mismo nombre varias veces si la API lo manda duplicado
      if (productosVistos.has(nombreNormalizado)) continue;
      productosVistos.add(nombreNormalizado);

      const catKey = (prod.category || 'Sin Categoría').toLowerCase().trim();
      const sku = prod.SKU || prod._id;

      // Llamamos a la función RPC que creamos en SQL
      // Esta función decide si toca el precio o no basado en el candado
      const { error: rpcError } = await supabase.rpc('sincronizar_producto_v2', {
        p_sku: sku,
        p_nombre: prod.name,
        p_descripcion: prod.description || '',
        p_stock: prod.amount || 0,
        p_precio_sistema: prod.sellingPrice || 0,
        p_categoria_id: catMap[catKey] || catMap['sin categoría']
      });

      if (rpcError) {
        console.error(`❌ Error en SKU ${sku}:`, rpcError.message);
        errores++;
      } else {
        procesados++;
      }
    }

    console.log("---");
    console.log(`✅ ¡Sincronización Finalizada!`);
    console.log(`✔️  Productos procesados: ${procesados}`);
    console.log(`✖️  Errores encontrados: ${errores}`);
    console.log("---");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO EN EL SCRIPT:", err.message);
  }
}

sincronizarTodo();