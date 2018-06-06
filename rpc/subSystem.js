const Deferred = require('promised-io/promise').Deferred
const when = require('promised-io/promise').when
const debug = require('debug')('p3api-server:Subsystem')
const request = require('request')
const config = require('../config')
const distributeURL = config.get('distributeURL')

function processSubsystem (ssState, options) {
  const def = new Deferred()

  const qSt = Date.now()

  const query = {
    q: 'genome_id:(' + ssState.genomeIds.join(' OR ') + ')',
    fq: 'subsystem_id:[* TO *]',
    rows: 0,
    facet: true,
    'json.facet': '{stat:{type:field,field:subsystem_id,sort:index,limit:-1,facet:{description:{type:field,field:subsystem_name},families:{type:field,field:genome_id,limit:-1,sort:{index:asc}}}}}'
  }
  const q = Object.keys(query).map(p => p + '=' + query[p]).join('&')

  request.post({
    url: distributeURL + 'subsystem/',
    headers: {
      'Accept': 'application/solr+json',
      'Content-Type': 'application/solrquery+x-www-form-urlencoded',
      'Authorization': options.token || ''
    },
    json: true,
    body: q
  }, function (error, res, response) {
    debug('facet query took ', (Date.now() - qSt) / 1000, 's')

    if (error) {
      return def.reject(error)
    }

    if (response.facets.count === 0) {
      // data is not available
      return def.resolve([])
    }
    const familyStat = response.facets.stat.buckets
    /*
    const familyIdList = familyStat.filter(el => el.val !== '').map(el => el.val)

    const fetchSize = 5000
    const steps = Math.ceil(familyIdList.length / fetchSize)
    const allRequests = []

    const q2St = Date.now()
    /*
      for(let i = 0; i < steps; i++){
        const subDef = Deferred();
        const subFamilyIdList = familyIdList.slice(i * fetchSize, Math.min((i + 1) * fetchSize, familyIdList.length));

        debug("subFamilyList: ", subFamilyIdList.length, i*fetchSize, Math.min((i+1)*fetchSize, familyIdList.length));
        request.post({
          url: distributeURL + 'subsystem/', // TODO: change to _ref after data populated
          json: true,
          headers: {
            'Accept': "application/json",
            'Content-Type': "application/solrquery+x-www-form-urlencoded",
            'Authorization': options.token || ""
          },
          body: 'q=subsystem_id:(' + subFamilyIdList.join(' OR ') + ')&fl=subsystem_id,subsystem_name&rows=' + subFamilyIdList.length
        }, function(error, resp, body){
          if(error){
            subDef.reject(error);
          }
          subDef.resolve(body);
        });
        allRequests.push(subDef);
      }
      debug("querying subsystem_ref: ", familyIdList.length);

      all(allRequests).then(function(body){
        debug("subsystem_ref took", (Date.now() - q2St) / 1000, "s");

        let res = body.reduce((r, b) => {
          return r.concat(b);
        }, []);
        */

    const familyGenomeCount = {}
    const familyGenomeIdCountMap = {}
    const familyGenomeIdSet = {}
    const genomePosMap = {}
    const genome_ids = ssState.genomeIds
    genome_ids.forEach((genomeId, idx) => genomePosMap[genomeId] = idx)

    familyStat.forEach((family) => {
      const familyId = family.val

      family.families.buckets.forEach((bucket) => {
        const genomeId = bucket.val
        const genomeCount = (bucket.count < 10) ? '0' + bucket.count.toString(16) : bucket.count.toString(16)
        const genomePos = genomePosMap[genomeId]

        if (familyGenomeIdCountMap.hasOwnProperty(familyId)) {
          familyGenomeIdCountMap[familyId][genomePos] = genomeCount
        } else {
          const genomeIdCount = new Array(genome_ids.length).fill('00')
          genomeIdCount[genomePos] = genomeCount
          familyGenomeIdCountMap[familyId] = genomeIdCount
        }

        if (familyGenomeIdSet.hasOwnProperty(familyId)) {
          familyGenomeIdSet[familyId].add(genomeId)
        } else {
          familyGenomeIdSet[familyId] = new Set([genomeId])
        }
      })
    })

    Object.keys(familyGenomeIdCountMap).forEach(familyId => {
      familyGenomeCount[familyId] = familyGenomeIdSet[familyId].size
    })

    const familyRefHash = {}
    // res.forEach(function(el){
    //   if(!(el.subsystem_id in familyRefHash)){
    //     familyRefHash[el.subsystem_id] = el.subsystem_name;
    //   }
    // });
    familyStat.forEach(el => {
      familyRefHash[el.val] = el.description.buckets[0].val
    })

    const data = []
    familyStat.filter(el => el.val !== '').forEach(el => {
      const familyId = el.val
      const featureCount = el.count

      const row = {
        subsystem_id: familyId,
        feature_count: featureCount,
        genome_count: familyGenomeCount[familyId],
        description: familyRefHash[familyId],
        genomes: familyGenomeIdCountMap[familyId].join('')
      }
      data.push(row)
    })

    def.resolve(data)
    // });
  })

  return def.promise
}

module.exports = {
  requireAuthentication: false,
  validate: function (params) {
    const ssState = params[0]
    return ssState && ssState.genomeIds.length > 0
  },
  execute: function (params) {
    const def = new Deferred()

    const ssState = params[0]
    const opts = params[1]

    when(processSubsystem(ssState, opts), function (result) {
      def.resolve(result)
    }, function (err) {
      def.reject('Unable to process protein subsystem queries. ' + err)
    })

    return def.promise
  }
}
